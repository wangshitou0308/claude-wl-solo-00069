import { useEffect, useState } from 'react';
import {
  createProject,
  deleteProject,
  listProjects,
  ProjectMeta,
  ProjectStore,
} from '../data/store';
import { StoreProvider, useStore } from './StoreContext';
import { RegisterTab } from './RegisterTab';
import { AlignmentTab } from './AlignmentTab';
import { CheckTab } from './CheckTab';
import { HandoffTab } from './HandoffTab';
import { HistoryTab } from './HistoryTab';
import { ROLE_LABEL } from '../domain/constants';

const LAST_KEY = 'eh-last-project';
type Tab = 'register' | 'align' | 'check' | 'handoff' | 'history';

export function App() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [store, setStore] = useState<ProjectStore | null>(null);

  async function refresh() {
    setProjects(await listProjects());
  }
  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!projects || store) return;
    const last = localStorage.getItem(LAST_KEY);
    if (last && projects.some((p) => p.id === last)) openProject(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  async function openProject(id: string) {
    const s = await ProjectStore.open(id);
    localStorage.setItem(LAST_KEY, id);
    setStore(s);
  }

  async function newProject() {
    const title = prompt('交接台名称（如：外婆牡丹绣 · 2026 春交接）', '绣样续作交接');
    if (!title?.trim()) return;
    const id = await createProject(title.trim());
    await refresh();
    await openProject(id);
  }

  async function removeProject(p: ProjectMeta) {
    if (!confirm(`删除「${p.title}」？该项目所有图像与记录将从本机清除，不可恢复。`)) return;
    await deleteProject(p.id);
    if (localStorage.getItem(LAST_KEY) === p.id) localStorage.removeItem(LAST_KEY);
    await refresh();
  }

  if (store) {
    return (
      <StoreProvider store={store}>
        <Workspace
          onClose={() => {
            localStorage.removeItem(LAST_KEY);
            setStore(null);
            refresh();
          }}
        />
      </StoreProvider>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>绣样续作交接核对台</h1>
        <span className="sub">长辈 × 晚辈 · 纯前端 · 资料只留在本机浏览器</span>
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>交接项目</h2>
            <div className="hint">每一次祖辈向晚辈的交接，可建一个独立核对台。</div>
          </div>
          <button className="primary" onClick={newProject}>
            ＋ 新建交接台
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {projects === null ? (
            <div className="hint">读取本机记录中…</div>
          ) : projects.length === 0 ? (
            <div className="empty">还没有交接台，点击「新建」开始。</div>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="proj-item" onClick={() => openProject(p.id)}>
                <div>
                  <b>{p.title}</b>
                  <div className="hint">
                    {new Date(p.updatedAt).toLocaleString('zh-CN')} · {p.eventCount} 条记录
                    {p.frozen && ' · 已冻结封存'}
                  </div>
                </div>
                <button
                  className="tiny ghost-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeProject(p);
                  }}
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <p className="hint">
        图像与记录均保存在浏览器 IndexedDB，不会上传；清理浏览器站点数据会一并删除，请在冻结前自行核对。
      </p>
    </div>
  );
}

function Workspace({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('register');
  const [identityId, setIdentityId] = useState<string | null>(null);

  const store = useStore();
  const state = store.getState();
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store]);

  if (!state) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'register', label: '登记资料' },
    { key: 'align', label: '叠图配套' },
    { key: 'check', label: '双方核对' },
    { key: 'handoff', label: '移交冻结' },
    { key: 'history', label: '记录轨迹' },
  ];

  return (
    <div className="app">
      <div className="topbar">
        <button className="tiny" onClick={onClose}>
          ← 项目列表
        </button>
        <h1>{state.title}</h1>
        {state.frozen && <span className="verdict matched">已冻结 · 只读</span>}
      </div>

      <div className="identitybar">
        <span>我是：</span>
        <select
          value={identityId ?? ''}
          onChange={(e) => setIdentityId(e.target.value || null)}
        >
          <option value="">未选择（仅浏览）</option>
          {state.participants.map((p) => (
            <option key={p.id} value={p.id}>
              {ROLE_LABEL[p.role]} · {p.name}
            </option>
          ))}
        </select>
        <span className="hint">所有确认、分歧与声明都以当前身份署名；不能替对方确认。</span>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'register' && <RegisterTab identityId={identityId} />}
      {tab === 'align' && <AlignmentTab identityId={identityId} />}
      {tab === 'check' && <CheckTab identityId={identityId} />}
      {tab === 'handoff' && <HandoffTab identityId={identityId} />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
