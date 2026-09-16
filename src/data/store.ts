import type {
  Artifact,
  Asset,
  DomainEvent,
  EventType,
  State,
} from '../domain/types';
import { fold, uid } from '../domain/fold';

const DB_NAME = 'embroidery-handover';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects'; // id -> { id, title, createdAt, updatedAt, frozen, eventCount }
const STORE_EVENTS = 'events'; // key `${projectId}:${seq}` -> event，索引 projectId
const STORE_ASSETS = 'assets'; // asset.id -> Asset（含 dataUrl）

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  frozen: boolean;
  eventCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS))
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const es = db.createObjectStore(STORE_EVENTS, { keyPath: 'key' });
        es.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS))
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_PROJECTS).objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () =>
      resolve(((req.result as ProjectMeta[]) ?? []).sort((a, b) => b.updatedAt - a.updatedAt));
    req.onerror = () => reject(req.error);
  });
}

async function putMeta(db: IDBDatabase, meta: ProjectMeta) {
  return new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE_PROJECTS, 'readwrite').objectStore(STORE_PROJECTS).put(meta);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function createProject(title: string): Promise<string> {
  const db = await openDb();
  const id = uid('proj');
  const at = Date.now();
  const event: DomainEvent = {
    id: uid('evt'),
    projectId: id,
    seq: 0,
    type: 'projectCreated',
    at,
    payload: { title },
  };
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_PROJECTS, STORE_EVENTS], 'readwrite');
    t.objectStore(STORE_EVENTS).put({ ...event, key: `${id}:0` });
    t.objectStore(STORE_PROJECTS).put({
      id,
      title,
      createdAt: at,
      updatedAt: at,
      frozen: false,
      eventCount: 1,
    } satisfies ProjectMeta);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  return id;
}

export async function loadEvents(projectId: string): Promise<DomainEvent[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const idx = db
      .transaction(STORE_EVENTS)
      .objectStore(STORE_EVENTS)
      .index('projectId')
      .getAll(projectId);
    idx.onsuccess = () =>
      resolve(((idx.result as DomainEvent[]) ?? []).sort((a, b) => a.seq - b.seq));
    idx.onerror = () => reject(idx.error);
  });
}

export async function loadAssets(projectId: string): Promise<Asset[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_ASSETS).objectStore(STORE_ASSETS).getAll();
    req.onsuccess = () =>
      resolve(((req.result as Asset[]) ?? []).filter((a) => a.projectId === projectId));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDb();
  const events = await loadEvents(projectId);
  const assets = await loadAssets(projectId);
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_PROJECTS, STORE_EVENTS, STORE_ASSETS], 'readwrite');
    for (const e of events) t.objectStore(STORE_EVENTS).delete(`${projectId}:${e.seq}`);
    for (const a of assets) t.objectStore(STORE_ASSETS).delete(a.id);
    t.objectStore(STORE_PROJECTS).delete(projectId);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

export class ProjectStore {
  private events: DomainEvent[] = [];
  private assets = new Map<string, Asset>();
  private state: State | null = null;
  private listeners = new Set<() => void>();
  projectId: string;

  private constructor(projectId: string) {
    this.projectId = projectId;
  }

  static async open(projectId: string): Promise<ProjectStore> {
    const store = new ProjectStore(projectId);
    const [events, assets] = await Promise.all([loadEvents(projectId), loadAssets(projectId)]);
    store.events = events;
    for (const a of assets) store.assets.set(a.id, a);
    store.state = fold(events);
    return store;
  }

  getState(): State | null {
    return this.state;
  }

  getAsset(id: string): Asset | undefined {
    return this.assets.get(id);
  }

  getEvents(): DomainEvent[] {
    return this.events;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private snapshot(): State {
    if (!this.state) throw new Error('项目未加载');
    return this.state;
  }

  /**
   * 追加事件。证据（声明、图像、物件）变动时，
   * 只级联“使相关配套失效”，不波及无关配套与人工核对结论。
   */
  async append(type: EventType, payload: any = {}, actorId?: string): Promise<void> {
    const before = this.snapshot();
    if (before.frozen) throw new Error('项目已冻结，不能修改记录');
    const seq = this.events.length;
    const event: DomainEvent = {
      id: uid('evt'),
      projectId: this.projectId,
      seq,
      type,
      at: Date.now(),
      actorId,
      payload,
    };
    const cascades: DomainEvent[] = [];
    const evidenceArtifactId = this.evidenceArtifactId(type, payload);
    if (evidenceArtifactId) {
      for (const p of before.pairings) {
        if (!p.invalidated && (p.aId === evidenceArtifactId || p.bId === evidenceArtifactId)) {
          cascades.push({
            id: uid('evt'),
            projectId: this.projectId,
            seq: seq + cascades.length + 1,
            type: 'pairInvalidated',
            at: Date.now(),
            payload: { id: p.id, reason: this.invalidationReason(type) },
          });
        }
      }
    }
    const all = [event, ...cascades];
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction([STORE_EVENTS, STORE_PROJECTS], 'readwrite');
      for (const e of all) t.objectStore(STORE_EVENTS).put({ ...e, key: `${this.projectId}:${e.seq}` });
      const meta: ProjectMeta = {
        id: this.projectId,
        title: before.title,
        createdAt: before.createdAt,
        updatedAt: Date.now(),
        frozen: false,
        eventCount: this.events.length + all.length,
      };
      t.objectStore(STORE_PROJECTS).put(meta);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    this.events.push(...all);
    this.state = fold(this.events);
    this.emit();
  }

  private evidenceArtifactId(type: EventType, payload: any): string | null {
    switch (type) {
      case 'statementSet':
        return payload.artifactId;
      case 'assetAdded':
        return payload.artifactId ?? null;
      case 'assetRemoved': {
        const asset = this.assets.get(payload.id);
        return asset?.artifactId ?? null;
      }
      default:
        return null;
    }
  }

  private invalidationReason(type: EventType): string {
    switch (type) {
      case 'statementSet':
        return '登记证据已修改';
      case 'assetAdded':
        return '新增了图像依据';
      case 'assetRemoved':
        return '图像依据被移除';
      default:
        return '证据发生变化';
    }
  }

  async addAsset(file: File, artifact: Artifact): Promise<void> {
    const dataUrl = await readFileAsDataUrl(file);
    const size = await readImageSize(dataUrl);
    const asset: Asset = {
      id: uid('asset'),
      projectId: this.projectId,
      artifactId: artifact.id,
      kind: 'photo',
      name: file.name,
      dataUrl,
      width: size.width,
      height: size.height,
      createdAt: Date.now(),
    };
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_ASSETS, 'readwrite');
      t.objectStore(STORE_ASSETS).put(asset);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    this.assets.set(asset.id, asset);
    await this.append('assetAdded', asset);
  }

  async removeAsset(assetId: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_ASSETS, 'readwrite');
      t.objectStore(STORE_ASSETS).delete(assetId);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    this.assets.delete(assetId);
    await this.append('assetRemoved', { id: assetId });
  }

  /** 冻结必须是最后一步；见证意见请在冻结前完成。 */
  async freeze(actorId: string): Promise<void> {
    await this.append('frozen', {}, actorId);
    const db = await openDb();
    const s = this.snapshot();
    await putMeta(db, {
      id: this.projectId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: Date.now(),
      frozen: true,
      eventCount: this.events.length,
    });
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
