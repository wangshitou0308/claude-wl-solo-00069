import { useState } from 'react';
import type {
  Artifact,
  FadingPayload,
  FeatureKey,
  FeaturePayload,
  HolePayload,
  MissingPayload,
  OutlinePayload,
  Pt,
  State,
  ThreadsPayload,
} from '../domain/types';
import { KIND_FEATURES } from '../domain/constants';
import { useStore } from './StoreContext';
import { SvgCanvas } from './SvgCanvas';
import { uid } from '../domain/fold';

interface Props {
  state: State;
  artifact: Artifact;
  feature: FeatureKey;
  authorId: string;
  photoUrl?: string;
}

const FEATURE_NAME: Record<FeatureKey, string> = {
  grain: '布纹方向',
  holes: '定位孔',
  outline: '已绣轮廓',
  threads: '线号',
  fading: '褪色',
  missing: '缺件',
};

export function FeatureEditor({ state, artifact, feature, authorId, photoUrl }: Props) {
  const store = useStore();
  const statement = state.statements.find(
    (s) => s.artifactId === artifact.id && s.feature === feature && s.authorId === authorId,
  );
  const author = state.participants.find((p) => p.id === authorId);
  const [busy, setBusy] = useState(false);

  async function save(payload: FeaturePayload) {
    setBusy(true);
    try {
      await store.append(
        'statementSet',
        {
          id: statement?.id ?? uid('st'),
          artifactId: artifact.id,
          feature,
          authorId,
          version: 0,
          payload,
          updatedAt: Date.now(),
        },
        authorId,
      );
    } finally {
      setBusy(false);
    }
  }

  const editable = !state.frozen;
  const others = state.statements.filter(
    (s) => s.artifactId === artifact.id && s.feature === feature && s.authorId !== authorId,
  );

  return (
    <div className="feature-block">
      <div className="feature-head">
        <b>{FEATURE_NAME[feature]}</b>
        {statement && (
          <span className="badge">
            {author?.name ?? '已登记'} · v{statement.version}
          </span>
        )}
        {!statement && <span className="hint">本人尚未登记</span>}
        {busy && <span className="hint">保存中…</span>}
      </div>
      {feature === 'grain' && (
        <GrainEditor value={statement?.payload as any} onSave={save} disabled={!editable} />
      )}
      {feature === 'holes' && (
        <HolesEditor
          value={statement?.payload as HolePayload | undefined}
          others={others}
          photoUrl={photoUrl}
          onSave={save}
          disabled={!editable}
        />
      )}
      {feature === 'outline' && (
        <OutlineEditor
          value={statement?.payload as OutlinePayload | undefined}
          others={others}
          photoUrl={photoUrl}
          onSave={save}
          disabled={!editable}
        />
      )}
      {feature === 'threads' && (
        <ThreadsEditor
          value={statement?.payload as ThreadsPayload | undefined}
          onSave={save}
          disabled={!editable}
        />
      )}
      {feature === 'fading' && (
        <FadingEditor
          value={statement?.payload as FadingPayload | undefined}
          others={others}
          photoUrl={photoUrl}
          onSave={save}
          disabled={!editable}
        />
      )}
      {feature === 'missing' && (
        <MissingEditor
          value={statement?.payload as MissingPayload | undefined}
          onSave={save}
          disabled={!editable}
        />
      )}
    </div>
  );
}

const fmtPt = (p: Pt) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`;

function GrainEditor({
  value,
  onSave,
  disabled,
}: {
  value: { angle: number; note?: string } | undefined;
  onSave: (p: FeaturePayload) => void;
  disabled: boolean;
}) {
  const [angle, setAngle] = useState(value?.angle ?? 0);
  const [note, setNote] = useState(value?.note ?? '');
  return (
    <div>
      <SvgCanvas
        mode="view"
        height={150}
        overlays={[
          {
            key: 'grain',
            color: '#a8473a',
            points: rotateLine(angle),
            dots: true,
          },
        ]}
      >
        <text x={3} y={9} fontSize={5} fill="#7a6b5e">
          正向箭头 {Math.round(((angle % 360) + 360) % 360)}°
        </text>
        <ArrowHead angle={angle} />
      </SvgCanvas>
      <div className="row" style={{ marginTop: 6 }}>
        <input
          type="range"
          min={0}
          max={359}
          value={angle}
          disabled={disabled}
          onChange={(e) => setAngle(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={0}
          max={359}
          value={angle}
          disabled={disabled}
          style={{ width: 64 }}
          onChange={(e) => setAngle(Number(e.target.value))}
        />
        <span className="hint">度</span>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input
          placeholder="备注（如：经线与布边夹角）"
          value={note}
          disabled={disabled}
          onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1 }}
        />
        <button disabled={disabled} onClick={() => onSave({ angle: ((angle % 360) + 360) % 360, note })}>
          保存方向
        </button>
      </div>
    </div>
  );
}

function rotateLine(angle: number): Pt[] {
  const a = (angle * Math.PI) / 180;
  const r = 34;
  return [
    { x: 50 - Math.sin(a) * r, y: 50 + Math.cos(a) * r },
    { x: 50 + Math.sin(a) * r, y: 50 - Math.cos(a) * r },
  ];
}

function ArrowHead({ angle }: { angle: number }) {
  const a = (angle * Math.PI) / 180;
  const x = 50 + Math.sin(a) * 34;
  const y = 50 - Math.cos(a) * 34;
  const p = (da: number) => {
    const aa = a + da;
    return `${x - Math.sin(aa) * 4},${y + Math.cos(aa) * 4}`;
  };
  return <polygon points={`${x},${y} ${p(2.6)} ${p(-2.6)}`} fill="#a8473a" />;
}

function HolesEditor({
  value,
  others,
  photoUrl,
  onSave,
  disabled,
}: {
  value: HolePayload | undefined;
  others: { authorId: string; payload: FeaturePayload }[] | any[];
  photoUrl?: string;
  onSave: (p: FeaturePayload) => void;
  disabled: boolean;
}) {
  const [points, setPoints] = useState<Pt[]>(value?.points ?? []);
  const overlayColor = '#3f658f';
  return (
    <div>
      <SvgCanvas
        background={photoUrl}
        mode={disabled ? 'view' : 'points'}
        height={220}
        hint="在定位孔位置逐点点击"
        overlays={others.map((o, i) => ({
          key: `o${i}`,
          color: overlayColor,
          points: (o.payload as HolePayload).points ?? [],
          r: 1.1,
        }))}
        onCommit={(pts) => setPoints(pts)}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <span className="hint">
          {points.length ? points.map(fmtPt).join(' ') : '未点'}
        </span>
        <button
          disabled={disabled || !points.length}
          onClick={() => onSave({ points } satisfies HolePayload)}
        >
          保存 {points.length} 个孔
        </button>
      </div>
    </div>
  );
}

function OutlineEditor({
  value,
  others,
  photoUrl,
  onSave,
  disabled,
}: {
  value: OutlinePayload | undefined;
  others: any[];
  photoUrl?: string;
  onSave: (p: FeaturePayload) => void;
  disabled: boolean;
}) {
  const [points, setPoints] = useState<Pt[]>(value?.points ?? []);
  const [open, setOpen] = useState(value?.open ?? false);
  return (
    <div>
      <SvgCanvas
        background={photoUrl}
        mode={disabled ? 'view' : 'polyline'}
        height={220}
        hint="按住沿已绣轮廓描线"
        overlays={others.map((o, i) => ({
          key: `o${i}`,
          color: '#3f658f',
          points: (o.payload as OutlinePayload).points ?? [],
          open: (o.payload as OutlinePayload).open,
          dots: false,
        }))}
        onCommit={(pts) => setPoints(pts)}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <label className="hint">
          <input
            type="checkbox"
            checked={open}
            disabled={disabled}
            onChange={(e) => setOpen(e.target.checked)}
          />{' '}
          开放线段（不闭合）
        </label>
        <button
          disabled={disabled || points.length < 2}
          onClick={() => onSave({ open, points } satisfies OutlinePayload)}
        >
          保存轮廓（{points.length} 点）
        </button>
      </div>
    </div>
  );
}

function ThreadsEditor({
  value,
  onSave,
  disabled,
}: {
  value: ThreadsPayload | undefined;
  onSave: (p: FeaturePayload) => void;
  disabled: boolean;
}) {
  const [lines, setLines] = useState(value?.lines ?? [{ code: '', color: '#c24a3d', amount: '' }]);
  const update = (i: number, k: 'code' | 'color' | 'amount', v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div>
      {lines.map((l, i) => (
        <div className="row" key={i} style={{ marginBottom: 4 }}>
          <input
            placeholder="线号（如 DMC 666）"
            value={l.code}
            disabled={disabled}
            style={{ width: 130 }}
            onChange={(e) => update(i, 'code', e.target.value)}
          />
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(l.color) ? l.color : '#cccccc'}
            disabled={disabled}
            onChange={(e) => update(i, 'color', e.target.value)}
            style={{ width: 42, padding: 2 }}
          />
          <input
            placeholder="余量（如 半支）"
            value={l.amount ?? ''}
            disabled={disabled}
            style={{ width: 110 }}
            onChange={(e) => update(i, 'amount', e.target.value)}
          />
          {lines.length > 1 && (
            <button className="tiny ghost-danger" disabled={disabled} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              删
            </button>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="tiny" disabled={disabled} onClick={() => setLines([...lines, { code: '', color: '#888888', amount: '' }])}>
          加一行
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            onSave({ lines: lines.filter((l) => l.code.trim()) } satisfies ThreadsPayload)
          }
        >
          保存线卡
        </button>
      </div>
    </div>
  );
}

const LEVEL_LABEL = { light: '轻度', medium: '中度', heavy: '重度' } as const;

function FadingEditor({
  value,
  others,
  photoUrl,
  onSave,
  disabled,
}: {
  value: FadingPayload | undefined;
  others: any[];
  photoUrl?: string;
  onSave: (p: FeaturePayload) => void;
  disabled: boolean;
}) {
  const [zones, setZones] = useState(value?.zones ?? []);
  const [level, setLevel] = useState<'light' | 'medium' | 'heavy'>('light');
  const overlays = [
    ...others.map((o, i) => {
      const z = (o.payload as FadingPayload).zones?.[0];
      return z
        ? { key: `o${i}`, color: '#3f658f', points: z.points, filled: true, dots: false }
        : null;
    }).filter(Boolean) as any[],
  ];
  return (
    <div>
      <SvgCanvas
        background={photoUrl}
        mode={disabled ? 'view' : 'polygon'}
        height={200}
        hint="沿褪色区描一个闭合区"
        overlays={overlays}
        commitLabel="圈定褪色区"
        onCommit={(pts) =>
          setZones((zs) => [{ id: uid('zone'), level, points: pts }, ...zs.slice(0, 2)])
        }
      />
      <div className="row" style={{ marginTop: 6 }}>
        {(['light', 'medium', 'heavy'] as const).map((lv) => (
          <label key={lv} className="hint">
            <input type="radio" checked={level === lv} disabled={disabled} onChange={() => setLevel(lv)} /> {LEVEL_LABEL[lv]}
          </label>
        ))}
        <button disabled={disabled} onClick={() => onSave({ zones } satisfies FadingPayload)}>
          保存褪色（{zones.length} 区）
        </button>
      </div>
    </div>
  );
}

function MissingEditor({
  value,
  onSave,
  disabled,
}: {
  value: MissingPayload | undefined;
  onSave: (p: FeaturePayload) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState((value?.items ?? []).join('\n'));
  return (
    <div>
      <textarea
        rows={3}
        style={{ width: '100%' }}
        placeholder="每行一件缺件，如：&#10;3号绣线一板&#10;左上角定位纸片"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ marginTop: 4 }}>
        <button
          disabled={disabled}
          onClick={() =>
            onSave({ items: text.split('\n').map((s) => s.trim()).filter(Boolean) } satisfies MissingPayload)
          }
        >
          保存缺件
        </button>
      </div>
    </div>
  );
}

export function featuresFor(kind: Artifact['kind']): FeatureKey[] {
  return KIND_FEATURES[kind];
}
