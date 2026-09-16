import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pairing, Transform } from '../domain/types';
import { FEATURE_LABEL, KIND_FEATURES, KIND_LABEL } from '../domain/constants';
import { overallVerdict, pairVerdict, pickStatement, transformPoint } from '../domain/compare';
import { useStore, useStateSnapshot } from './StoreContext';
import { uid } from '../domain/fold';

const VB = 100;

export function AlignmentTab({ identityId }: { identityId: string | null }) {
  const store = useStore();
  const state = useStateSnapshot();
  const [overZone, setOverZone] = useState<'a' | 'b' | null>(null);
  const [draftA, setDraftA] = useState<string | null>(null);
  const [draftB, setDraftB] = useState<string | null>(null);

  const elder = state.participants.find((p) => p.role === 'elder');
  const junior = state.participants.find((p) => p.role === 'junior');

  async function ensurePair() {
    if (!draftA || !draftB || draftA === draftB) return;
    if (state.pairings.some((p) => p.aId === draftA && p.bId === draftB)) return;
    const ka = state.artifacts.find((a) => a.id === draftA)!.kind;
    const kb = state.artifacts.find((a) => a.id === draftB)!.kind;
    const features = KIND_FEATURES[ka].filter((f) => KIND_FEATURES[kb].includes(f));
    const pair: Pairing = {
      id: uid('pair'),
      aId: draftA,
      bId: draftB,
      authorA: elder?.id,
      authorB: junior?.id,
      transform: { rotation: 0, tx: 0, ty: 0, scale: 1 },
      features,
      invalidated: false,
      createdAt: Date.now(),
    };
    await store.append('pairCreated', pair, identityId ?? undefined);
    setDraftA(null);
    setDraftB(null);
  }

  useEffect(() => {
    if (draftA && draftB) ensurePair();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftA, draftB]);

  function dropTo(side: 'a' | 'b', id: string) {
    if (side === 'a') setDraftA(id);
    else setDraftB(id);
    setOverZone(null);
  }

  return (
    <div>
      <div className="panel">
        <h2>③ 拖拽配套：哪张纸样对哪块绣片</h2>
        <p className="hint">
          把散开的资料分别拖入两侧：长辈侧作为底图不动，晚辈侧可旋转、平移、缩放叠合。落下即建立配套；只有双方登记的特征才会进入比对。
        </p>
        <div className="grid2" style={{ marginBottom: 12 }}>
          <DropZone
            title="长辈侧（底图）"
            artifactId={draftA}
            active={overZone === 'a'}
            onDragOver={() => setOverZone('a')}
            onDragLeave={() => setOverZone(null)}
            onDrop={(id) => dropTo('a', id)}
          />
          <DropZone
            title="晚辈侧（叠加对齐）"
            artifactId={draftB}
            active={overZone === 'b'}
            onDragOver={() => setOverZone('b')}
            onDragLeave={() => setOverZone(null)}
            onDrop={(id) => dropTo('b', id)}
          />
        </div>
        <div className="row">
          {state.artifacts.map((a) => (
            <div
              key={a.id}
              className="chip"
              draggable={!state.frozen}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/artifact-id', a.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDragEnd={() => {
                setOverZone(null);
              }}
              style={{ cursor: state.frozen ? 'default' : 'grab', padding: '6px 12px', border: '1px solid var(--line)' }}
            >
              <span className="badge">{KIND_LABEL[a.kind]}</span> {a.label}
            </div>
          ))}
          {state.artifacts.length === 0 && <span className="hint">先到「登记」页建档。</span>}
        </div>
      </div>

      {state.pairings.map((p) => (
        <PairPanel key={p.id} pair={p} identityId={identityId} />
      ))}
    </div>
  );
}

function DropZone({
  title,
  artifactId,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  title: string;
  artifactId: string | null;
  active: boolean;
  onDragOver: (id: string) => void;
  onDragLeave: () => void;
  onDrop: (id: string) => void;
}) {
  const store = useStore();
  const state = useStateSnapshot();
  const artifact = artifactId ? state.artifacts.find((a) => a.id === artifactId) : undefined;
  const photo = artifact?.assetIds.map((id) => store.getAsset(id)?.dataUrl).find(Boolean);
  return (
    <div
      className={`card ${active ? 'drag-over' : ''}`}
      style={{ minHeight: 120, borderStyle: artifact ? 'solid' : 'dashed' }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver('');
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/artifact-id');
        if (id) onDrop(id);
      }}
    >
      <div className="hint" style={{ marginBottom: 6 }}>
        {title}
      </div>
      {artifact ? (
        <div className="row">
          {photo && (
            <img src={photo} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
          )}
          <b>
            <span className="badge">{KIND_LABEL[artifact.kind]}</span> {artifact.label}
          </b>
        </div>
      ) : (
        <div className="hint">拖一件资料到这里</div>
      )}
    </div>
  );
}

function useDebouncedCommit(value: Transform, onCommit: (t: Transform) => void, frozen: boolean) {
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (frozen) return;
    if (ref.current) window.clearTimeout(ref.current);
    ref.current = window.setTimeout(() => onCommit(value), 350);
    return () => {
      if (ref.current) window.clearTimeout(ref.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.rotation, value.tx, value.ty, value.scale]);
}

function PairPanel({ pair, identityId }: { pair: Pairing; identityId: string | null }) {
  const store = useStore();
  const state = useStateSnapshot();
  const a = state.artifacts.find((x) => x.id === pair.aId);
  const b = state.artifacts.find((x) => x.id === pair.bId);
  const [local, setLocal] = useState<Transform>(pair.transform);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => setLocal(pair.transform), [pair.transform.rotation, pair.transform.tx, pair.transform.ty, pair.transform.scale, pair.id]);

  useDebouncedCommit(
    local,
    (t) => {
      if (
        t.rotation !== pair.transform.rotation ||
        t.tx !== pair.transform.tx ||
        t.ty !== pair.transform.ty ||
        (t.scale ?? 1) !== (pair.transform.scale ?? 1)
      ) {
        store.append('pairXformChanged', { id: pair.id, transform: t }, identityId ?? undefined);
      }
    },
    state.frozen,
  );

  const verdicts = useMemo(
    () => pairVerdict(pair, state.statements, state.participants),
    [pair, state.statements, state.participants],
  );
  const overall = overallVerdict(verdicts);
  const photoA = a?.assetIds.map((id) => store.getAsset(id)?.dataUrl).find(Boolean);
  const photoB = b?.assetIds.map((id) => store.getAsset(id)?.dataUrl).find(Boolean);

  const availableFeatures = a && b ? KIND_FEATURES[a.kind].filter((f) => KIND_FEATURES[b.kind].includes(f)) : [];

  function svgPt(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * VB, y: ((e.clientY - rect.top) / rect.height) * VB };
  }

  const s = local.scale ?? 1;

  return (
    <div className={`panel ${pair.invalidated ? 'dim' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <b>
            {a?.label ?? '（已删除）'} ⇄ {b?.label ?? '（已删除）'}
          </b>
          <span className={`verdict ${pair.invalidated ? 'none' : overall}`}>
            {pair.invalidated ? '已失效·待重核' : `综合：${overall === 'matched' ? '一致' : overall === 'conflict' ? '有硬冲突' : overall === 'candidate' ? '候选' : '未比对'}`}
          </span>
        </div>
        {!state.frozen && (
          <button
            className="tiny ghost-danger"
            onClick={() => {
              if (confirm('解除这套配套？')) store.append('pairRemoved', { id: pair.id }, identityId ?? undefined);
            }}
          >
            解除配套
          </button>
        )}
      </div>

      {pair.invalidated && (
        <div className="notice warn" style={{ marginTop: 8 }}>
          相关证据发生变化（{pair.invalidReason}），本配套自动失效，历史判定仍保留。重新对齐或调整比对特征后可恢复。
        </div>
      )}

      <div className="grid2" style={{ marginTop: 10 }}>
        <div className="svg-wrap">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB} ${VB}`}
            style={{ height: 340, touchAction: 'none' }}
            onPointerDown={(e) => {
              if (state.frozen) return;
              const p = svgPt(e);
              dragStart.current = { x: p.x, y: p.y, tx: local.tx, ty: local.ty };
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragStart.current) return;
              const p = svgPt(e);
              setLocal((t) => ({
                ...t,
                tx: +(dragStart.current!.tx + (p.x - dragStart.current!.x)).toFixed(1),
                ty: +(dragStart.current!.ty + (p.y - dragStart.current!.y)).toFixed(1),
              }));
            }}
            onPointerUp={() => (dragStart.current = null)}
          >
            {photoA ? (
              <image href={photoA} x={0} y={0} width={VB} height={VB} preserveAspectRatio="xMidYMid meet" opacity={0.85} />
            ) : (
              <rect x={0} y={0} width={VB} height={VB} fill="#f4ede4" />
            )}
            {/* 长辈侧声明叠绘 */}
            {pair.features.map((f) => (
              <StatementOverlay key={`a-${f}`} pair={pair} side="a" feature={f} color="#3f658f" />
            ))}
            {/* 晚辈侧图像：平移 + 绕中心旋转 + 绕中心缩放 */}
            <g transform={`translate(${local.tx} ${local.ty}) rotate(${local.rotation} 50 50)`}>
              <g transform={`translate(${50 - 50 * s} ${50 - 50 * s}) scale(${s})`}>
                {photoB && (
                  <image href={photoB} x={0} y={0} width={VB} height={VB} preserveAspectRatio="xMidYMid meet" opacity={0.55} />
                )}
              </g>
            </g>
            {/* 晚辈侧声明：用与比对一致的 transformPoint 换算到世界坐标叠绘 */}
            {pair.features.map((f) => (
              <StatementOverlay key={`bt-${f}`} pair={pair} side="b" feature={f} color="#a8473a" />
            ))}
          </svg>
          <div className="hint" style={{ padding: '4px 8px' }}>
            蓝＝长辈侧底图与声明；红＝晚辈侧。拖动画面平移晚辈侧。
          </div>
        </div>

        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <AuthorPicker pair={pair} side="a" />
            <AuthorPicker pair={pair} side="b" />
          </div>

          <div style={{ margin: '8px 0' }}>
            <div className="row">
              <span className="hint" style={{ width: 56 }}>旋转</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={local.rotation}
                disabled={state.frozen}
                style={{ flex: 1 }}
                onChange={(e) => setLocal((t) => ({ ...t, rotation: Number(e.target.value) }))}
              />
              <span className="hint" style={{ width: 42 }}>{Math.round(local.rotation)}°</span>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <span className="hint" style={{ width: 56 }}>水平</span>
              <input type="range" min={-40} max={40} step={0.5} value={local.tx} disabled={state.frozen} style={{ flex: 1 }}
                onChange={(e) => setLocal((t) => ({ ...t, tx: Number(e.target.value) }))} />
              <span className="hint" style={{ width: 42 }}>{local.tx}</span>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <span className="hint" style={{ width: 56 }}>垂直</span>
              <input type="range" min={-40} max={40} step={0.5} value={local.ty} disabled={state.frozen} style={{ flex: 1 }}
                onChange={(e) => setLocal((t) => ({ ...t, ty: Number(e.target.value) }))} />
              <span className="hint" style={{ width: 42 }}>{local.ty}</span>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <span className="hint" style={{ width: 56 }}>缩放</span>
              <input type="range" min={0.5} max={1.6} step={0.01} value={s} disabled={state.frozen} style={{ flex: 1 }}
                onChange={(e) => setLocal((t) => ({ ...t, scale: Number(e.target.value) }))} />
              <span className="hint" style={{ width: 42 }}>{s.toFixed(2)}</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="tiny" disabled={state.frozen} onClick={() => setLocal((t) => ({ ...t, rotation: +(((t.rotation - 90) % 360) + 360) % 360 - 180 }))}>↺ 90°</button>
              <button className="tiny" disabled={state.frozen} onClick={() => setLocal((t) => ({ ...t, rotation: +(((t.rotation + 90) % 360) + 360) % 360 - 180 }))}>90° ↻</button>
              <button className="tiny" disabled={state.frozen} onClick={() => setLocal({ rotation: 0, tx: 0, ty: 0, scale: 1 })}>复位</button>
            </div>
          </div>

          <h3>参与比对的特征</h3>
          <div className="row">
            {availableFeatures.map((f) => {
              const on = pair.features.includes(f);
              return (
                <button
                  key={f}
                  className="tiny"
                  disabled={state.frozen}
                  style={on ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                  onClick={() => store.append('pairFeatToggled', { id: pair.id, feature: f }, identityId ?? undefined)}
                >
                  {FEATURE_LABEL[f]}
                </button>
              );
            })}
          </div>

          <h3>逐项判定</h3>
          {verdicts.length === 0 && <div className="hint">未选取比对特征。</div>}
          {verdicts.map((v) => (
            <div key={v.key} className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
              <span>{FEATURE_LABEL[v.key]}</span>
              <span className="row">
                <span className="hint">{v.detail}</span>
                <span className={`verdict ${v.verdict}`}>
                  {v.verdict === 'matched' ? '一致' : v.verdict === 'conflict' ? '硬冲突' : '候选'}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuthorPicker({ pair, side }: { pair: Pairing; side: 'a' | 'b' }) {
  const store = useStore();
  const state = useStateSnapshot();
  const value = side === 'a' ? pair.authorA : pair.authorB;
  return (
    <label className="hint row">
      {side === 'a' ? '长辈侧取声明' : '晚辈侧取声明'}
      <select
        disabled={state.frozen}
        value={value ?? ''}
        onChange={(e) =>
          store.append(
            'pairAuthorChanged',
            side === 'a'
              ? { id: pair.id, authorA: e.target.value || undefined, authorB: pair.authorB }
              : { id: pair.id, authorA: pair.authorA, authorB: e.target.value || undefined },
          )
        }
      >
        <option value="">按角色自动</option>
        {state.participants.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatementOverlay({
  pair,
  side,
  feature,
  color,
}: {
  pair: Pairing;
  side: 'a' | 'b';
  feature: keyof typeof FEATURE_LABEL;
  color: string;
}) {
  const state = useStateSnapshot();
  const artifactId = side === 'a' ? pair.aId : pair.bId;
  const st = pickStatement(
    state.statements,
    artifactId,
    feature,
    side === 'a' ? pair.authorA : pair.authorB,
    state.participants,
    side === 'a' ? 'elder' : 'junior',
  );
  if (!st) return null;
  const tf = (pts: { x: number; y: number }[]) =>
    side === 'b' ? pts.map((p) => transformPoint(p, pair.transform)) : pts;

  switch (feature) {
    case 'holes': {
      const pts = tf((st.payload as any).points ?? []);
      return (
        <g>
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={1.6} fill="none" stroke={color} strokeWidth={0.7} />
          ))}
        </g>
      );
    }
    case 'outline': {
      const pts = tf((st.payload as any).points ?? []);
      if (pts.length < 2) return null;
      return (
        <path
          d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
      );
    }
    case 'grain': {
      const rawAngle = (st.payload as any).angle as number;
      const ang = side === 'b' ? rawAngle + pair.transform.rotation : rawAngle;
      const aa = (ang * Math.PI) / 180;
      const r = 30;
      const x1 = 50 - Math.sin(aa) * r;
      const y1 = 50 + Math.cos(aa) * r;
      const x2 = 50 + Math.sin(aa) * r;
      const y2 = 50 - Math.cos(aa) * r;
      return (
        <g>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1} strokeDasharray="3 2" />
          <polygon
            points={`${x2},${y2} ${x2 - Math.sin(aa + 2.6) * 4},${y2 + Math.cos(aa + 2.6) * 4} ${
              x2 - Math.sin(aa - 2.6) * 4
            },${y2 + Math.cos(aa - 2.6) * 4}`}
            fill={color}
          />
        </g>
      );
    }
    case 'fading': {
      const z = (st.payload as any).zones?.[0];
      if (!z) return null;
      const pts = tf(z.points ?? []);
      if (pts.length < 3) return null;
      return <polygon points={pts.map((p: any) => `${p.x},${p.y}`).join(' ')} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={0.6} />;
    }
    default:
      return null;
  }
}
