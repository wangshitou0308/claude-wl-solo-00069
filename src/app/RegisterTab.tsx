import { useRef, useState } from 'react';
import type { ArtifactKind, Role } from '../domain/types';
import { KIND_FEATURES, KIND_LABEL, ROLE_LABEL } from '../domain/constants';
import { useStore, useStateSnapshot } from './StoreContext';
import { FeatureEditor } from './FeatureEditor';
import { uid } from '../domain/fold';

export function RegisterTab({ identityId }: { identityId: string | null }) {
  const store = useStore();
  const state = useStateSnapshot();

  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('elder');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<ArtifactKind>('piece');

  const rolesTaken = new Set(state.participants.map((p) => p.role));

  return (
    <div>
      <div className="panel">
        <h2>① 参与人登记</h2>
        <p className="hint">
          长辈与晚辈是交接双方；见证家属可选。登记后的声明、确认与分歧都会记录在具体人名下，冻结版一并保留。
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          {state.participants.map((p) => (
            <span key={p.id} className={`badge ${p.role}`}>
              {ROLE_LABEL[p.role]} · {p.name}
            </span>
          ))}
        </div>
        {!state.frozen && (
          <div className="row">
            <input
              placeholder="称呼（如 外婆 / 阿芸）"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(['elder', 'junior', 'witness'] as Role[])
                .filter((r) => r === 'witness' || !rolesTaken.has(r))
                .map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
            </select>
            <button
              className="primary"
              disabled={!name.trim() || (role !== 'witness' && rolesTaken.has(role))}
              onClick={async () => {
                await store.append(
                  'participantAdded',
                  { id: uid('p'), name: name.trim(), role, createdAt: Date.now() },
                  identityId ?? undefined,
                );
                setName('');
              }}
            >
              登记参与人
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>② 散开的资料逐件建档</h2>
        <p className="hint">
          绣片、描样纸、线卡、针法便签分别建档，拍照留作图像依据；每件资料由本人登记布纹方向、定位孔、已绣轮廓、线号、褪色与缺件。
        </p>
        {!state.frozen && (
          <div className="row" style={{ marginBottom: 14 }}>
            <input
              placeholder="资料名称（如 主绣片·牡丹）"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind)}>
              {(Object.keys(KIND_LABEL) as ArtifactKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!label.trim()}
              onClick={async () => {
                await store.append(
                  'artifactAdded',
                  {
                    id: uid('art'),
                    kind,
                    label: label.trim(),
                    createdAt: Date.now(),
                    assetIds: [],
                  },
                  identityId ?? undefined,
                );
                setLabel('');
              }}
            >
              建档
            </button>
          </div>
        )}

        {state.artifacts.length === 0 && <div className="empty">还没有资料，先为第一块绣片建档吧。</div>}

        <div className="grid2">
          {state.artifacts.map((a) => (
            <ArtifactCard key={a.id} artifactId={a.id} identityId={identityId} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtifactCard({ artifactId, identityId }: { artifactId: string; identityId: string | null }) {
  const store = useStore();
  const state = useStateSnapshot();
  const artifact = state.artifacts.find((a) => a.id === artifactId)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const photos = artifact.assetIds.map((id) => store.getAsset(id)).filter(Boolean) as NonNull<
    ReturnType<typeof store.getAsset>
  >[];
  const firstPhoto = photos[0]?.dataUrl;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <span className="badge">{KIND_LABEL[artifact.kind]}</span>
          <b>{artifact.label}</b>
        </div>
        <div className="row">
          <button className="tiny" onClick={() => setOpen((v) => !v)}>
            {open ? '收起登记' : '展开登记'}
          </button>
          {!state.frozen && (
            <button
              className="tiny ghost-danger"
              onClick={() => {
                if (confirm(`删除「${artifact.label}」？相关声明与配套将一并移除。`))
                  store.append('artifactRemoved', { id: artifact.id }, identityId ?? undefined);
              }}
            >
              删除
            </button>
          )}
        </div>
      </div>

      <div className="hint" style={{ margin: '6px 0' }}>
        {photos.length} 张图像依据 ·{' '}
        {new Set(
          state.statements.filter((s) => s.artifactId === artifact.id).map((s) => s.authorId),
        ).size}{' '}
        人已登记
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        {photos.slice(0, 2).map((p) => (
          <div key={p.id} style={{ flex: 1, position: 'relative' }}>
            <img
              className="thumb"
              src={p.dataUrl}
              alt={p.name}
              onClick={() => !state.frozen && store.removeAsset(p.id)}
              title={state.frozen ? p.name : '点击删除'}
            />
          </div>
        ))}
        {!state.frozen && (
          <button
            className="thumb"
            style={{
              maxWidth: 130,
              height: 130,
              borderStyle: 'dashed',
              color: 'var(--ink-soft)',
            }}
            onClick={() => fileRef.current?.click()}
          >
            ＋拍照/选图
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await store.addAsset(f, artifact);
            e.target.value = '';
          }}
        />
      </div>

      {open && identityId && (
        <div>
          {KIND_FEATURES[artifact.kind].map((f) => (
            <FeatureEditor
              key={f}
              state={state}
              artifact={artifact}
              feature={f}
              authorId={identityId}
              photoUrl={firstPhoto}
            />
          ))}
        </div>
      )}
      {open && !identityId && <div className="notice info" style={{ marginTop: 8 }}>请先在顶部选择「我是谁」，再登记本人证据。</div>}
    </div>
  );
}

type NonNull<T> = Exclude<T, undefined>;
