import type {
  Artifact,
  Asset,
  CheckKey,
  DomainEvent,
  FeatureKey,
  Pairing,
  Participant,
  State,
  Statement,
  Transform,
} from './types';
import { emptyChecks } from './constants';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function freshState(projectId: string, title: string, at: number): State {
  return {
    projectId,
    title,
    createdAt: at,
    frozen: false,
    participants: [],
    artifacts: [],
    statements: [],
    pairings: [],
    checks: emptyChecks(),
    handoffElderConfirmed: false,
    handoffJuniorConfirmed: false,
    lastSeq: 0,
  };
}

/**
 * 折叠事件流。事件不可变、只追加；
 * 证据（声明/图像/物件）修改时按依赖使相关配套失效，
 * 并回退受影响的核对项——这些副作用在 appendEvent 处生成额外事件，
 * fold 本身保持纯粹。
 */
export function fold(events: DomainEvent[]): State | null {
  if (!events.length) return null;
  let s: State = freshState(events[0].projectId, events[0].payload?.title ?? '交接', events[0].at);

  for (const e of events) {
    s = apply(s, e);
    s.lastSeq = e.seq;
  }
  return s;
}

function apply(s: State, e: DomainEvent): State {
  switch (e.type) {
    case 'projectCreated':
      return { ...s, title: e.payload.title };
    case 'projectRenamed':
      return { ...s, title: e.payload.title };
    case 'participantAdded':
      return { ...s, participants: [...s.participants, e.payload as Participant] };
    case 'artifactAdded':
      return { ...s, artifacts: [...s.artifacts, e.payload as Artifact] };
    case 'artifactRemoved':
      return {
        ...s,
        artifacts: s.artifacts.filter((a) => a.id !== e.payload.id),
        pairings: s.pairings.filter(
          (p) => p.aId !== e.payload.id && p.bId !== e.payload.id,
        ),
        statements: s.statements.filter((st) => st.artifactId !== e.payload.id),
      };
    case 'artifactRenamed':
      return {
        ...s,
        artifacts: s.artifacts.map((a) =>
          a.id === e.payload.id ? { ...a, label: e.payload.label } : a,
        ),
      };
    case 'assetAdded': {
      const asset = e.payload as Asset;
      return {
        ...s,
        artifacts: asset.artifactId
          ? s.artifacts.map((a) =>
              a.id === asset.artifactId ? { ...a, assetIds: [...a.assetIds, asset.id] } : a,
            )
          : s.artifacts,
      };
    }
    case 'assetRemoved': {
      const id = e.payload.id as string;
      return {
        ...s,
        artifacts: s.artifacts.map((a) =>
          a.assetIds.includes(id) ? { ...a, assetIds: a.assetIds.filter((x) => x !== id) } : a,
        ),
      };
    }
    case 'statementSet': {
      const incoming = e.payload as Statement;
      const idx = s.statements.findIndex(
        (x) => x.artifactId === incoming.artifactId && x.feature === incoming.feature && x.authorId === incoming.authorId,
      );
      const st: Statement =
        idx >= 0
          ? { ...incoming, version: s.statements[idx].version + 1 }
          : { ...incoming, version: 1 };
      const next = [...s.statements];
      if (idx >= 0) next[idx] = st;
      else next.push(st);
      return { ...s, statements: next };
    }
    case 'pairCreated':
      return { ...s, pairings: [...s.pairings, e.payload as Pairing] };
    case 'pairRemoved':
      return { ...s, pairings: s.pairings.filter((p) => p.id !== e.payload.id) };
    case 'pairInvalidated':
      return {
        ...s,
        pairings: s.pairings.map((p) =>
          p.id === e.payload.id
            ? { ...p, invalidated: true, invalidReason: e.payload.reason }
            : p,
        ),
      };
    case 'pairAuthorChanged':
      return {
        ...s,
        pairings: s.pairings.map((p) =>
          p.id === e.payload.id
            ? { ...p, authorA: e.payload.authorA, authorB: e.payload.authorB }
            : p,
        ),
      };
    case 'pairFeatToggled': {
      const { id, feature } = e.payload as { id: string; feature: FeatureKey };
      return {
        ...s,
        pairings: s.pairings.map((p) =>
          p.id === id
            ? {
                ...p,
                // 人工重新选取比对特征视为重建配套，失效标记解除
                invalidated: false,
                invalidReason: undefined,
                features: p.features.includes(feature)
                  ? p.features.filter((f) => f !== feature)
                  : [...p.features, feature],
              }
            : p,
        ),
      };
    }
    case 'pairXformChanged':
      return {
        ...s,
        pairings: s.pairings.map((p) =>
          p.id === e.payload.id
            ? {
                ...p,
                transform: e.payload.transform as Transform,
                // 重新对齐后失效解除，按新位置重新判定
                invalidated: false,
                invalidReason: undefined,
              }
            : p,
        ),
      };
    case 'checkConfirmed':
      return updateCheck(s, e.payload.key, (c) => {
        const by = e.payload.participantId as string;
        const confirmedBy = c.confirmedBy.includes(by) ? c.confirmedBy : [...c.confirmedBy, by];
        return { ...c, confirmedBy, status: deriveStatus(confirmedBy) };
      });
    case 'checkWithdrawn':
      return updateCheck(s, e.payload.key, (c) => {
        const by = e.payload.participantId as string;
        const confirmedBy = c.confirmedBy.filter((x) => x !== by);
        return {
          ...c,
          confirmedBy,
          status: c.status === 'disputed' ? 'disputed' : deriveStatus(confirmedBy),
        };
      });
    case 'checkDisputed':
      return updateCheck(s, e.payload.key, (c) => ({
        ...c,
        status: 'disputed',
        disputes: [
          ...c.disputes,
          {
            id: e.payload.disputeId,
            participantId: e.payload.participantId,
            reason: e.payload.reason ?? '',
            at: e.at,
          },
        ],
        // 停在上一共同状态：冻结进入分歧前的确认集合
        lastJointStatus: c.lastJointStatus ?? (c.status === 'joint' ? 'joint' : c.status),
        lastJointConfirmedBy: c.lastJointConfirmedBy ?? [...c.confirmedBy],
      }));
    case 'checkResolved':
      return updateCheck(s, e.payload.key, (c) => {
        const disputes = [...c.disputes];
        for (let i = disputes.length - 1; i >= 0; i--) {
          if (!disputes[i].resolvedAt) {
            disputes[i] = { ...disputes[i], resolvedAt: e.at };
            break;
          }
        }
        return {
          ...c,
          disputes,
          status: deriveStatus(c.confirmedBy),
          lastJointStatus: undefined,
          lastJointConfirmedBy: undefined,
        };
      });
    case 'handoffConfirmed': {
      if (e.payload.role === 'elder') return { ...s, handoffElderConfirmed: true };
      if (e.payload.role === 'junior') return { ...s, handoffJuniorConfirmed: true };
      return s;
    }
    case 'handoffWithdrawn': {
      if (e.payload.role === 'elder') return { ...s, handoffElderConfirmed: false };
      if (e.payload.role === 'junior') return { ...s, handoffJuniorConfirmed: false };
      return s;
    }
    case 'handoffWitnessed':
      return {
        ...s,
        witnessAttestation: {
          witnessId: e.payload.witnessId,
          note: e.payload.note ?? '',
          at: e.at,
        },
      };
    case 'frozen':
      return { ...s, frozen: true, frozenAt: e.at };
    default:
      return s;
  }
}

function deriveStatus(confirmedBy: string[]): State['checks'][CheckKey]['status'] {
  if (confirmedBy.length >= 2) return 'joint';
  if (confirmedBy.length === 1) return 'partial';
  return 'open';
}

function updateCheck(s: State, key: CheckKey, fn: (c: State['checks'][CheckKey]) => State['checks'][CheckKey]): State {
  return { ...s, checks: { ...s.checks, [key]: fn(s.checks[key]) } };
}
