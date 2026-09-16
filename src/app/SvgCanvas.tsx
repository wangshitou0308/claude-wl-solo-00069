import { useRef, useState } from 'react';
import type { Pt } from '../domain/types';

export type CanvasMode = 'view' | 'points' | 'polyline' | 'polygon';

interface Props {
  background?: string;
  mode: CanvasMode;
  /** 只读叠绘层（用于显示对方声明） */
  overlays?: Overlay[];
  height?: number;
  onCommit?: (pts: Pt[]) => void;
  commitLabel?: string;
  hint?: string;
  strokeColor?: string;
  children?: React.ReactNode;
}

export interface Overlay {
  key: string;
  color: string;
  dash?: string;
  points: Pt[];
  open?: boolean;
  filled?: boolean;
  dots?: boolean;
  r?: number;
}

const VB = 100;

function toSvgPt(e: React.PointerEvent<SVGSVGElement>, svg: SVGSVGElement): Pt {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * VB,
    y: ((e.clientY - rect.top) / rect.height) * VB,
  };
}

export function SvgCanvas({
  background,
  mode,
  overlays = [],
  height = 240,
  onCommit,
  commitLabel = '完成',
  hint,
  strokeColor = '#a8473a',
  children,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Pt[]>([]);

  const editable = mode !== 'view';

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!editable) return;
    const p = toSvgPt(e, svgRef.current!);
    if (mode === 'points') {
      const next = [...draft, p];
      setDraft(next);
      onCommit?.(next);
    } else {
      setDraft((d) => [...d, p]);
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!editable || e.buttons !== 1 || mode === 'points') return;
    if (!draft.length) return;
    const p = toSvgPt(e, svgRef.current!);
    const last = draft[draft.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return;
    const next = [...draft, p];
    setDraft(next);
  }

  function commit() {
    if (mode === 'polyline' || mode === 'polygon') {
      if (draft.length >= 2) onCommit?.(draft);
    }
    setDraft([]);
  }

  function undo() {
    setDraft((d) => d.slice(0, -1));
  }

  return (
    <div className="svg-wrap" style={{ maxWidth: 420 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB} ${VB}`}
        style={{ height, cursor: editable ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        {background && (
          <image href={background} x={0} y={0} width={VB} height={VB} preserveAspectRatio="xMidYMid meet" />
        )}
        {!background && <rect x={0} y={0} width={VB} height={VB} fill="#fdfbf7" />}
        {overlays.map((o) => (
          <OverlayShape key={o.key} o={o} />
        ))}
        {editable && draft.length > 0 && (
          <OverlayShape
            o={{
              key: 'draft',
              color: strokeColor,
              points: draft,
              open: mode === 'polyline',
              dots: mode === 'points',
              dash: '2 1.5',
            }}
          />
        )}
        {children}
      </svg>
      {editable && (
        <div className="row" style={{ padding: '6px 8px' }}>
          <span className="hint">{hint}</span>
          {mode !== 'points' && (
            <>
              <button className="tiny" onClick={commit}>
                {commitLabel}
              </button>
              <button className="tiny" onClick={undo}>
                撤销一点
              </button>
            </>
          )}
          <button className="tiny ghost-danger" onClick={() => setDraft([])}>
            清除
          </button>
        </div>
      )}
    </div>
  );
}

export function OverlayShape({ o }: { o: Overlay }) {
  if (!o.points.length) return null;
  const d =
    o.points.length === 1
      ? ''
      : o.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
        (o.filled ? ' Z' : '');
  return (
    <g>
      {o.filled && o.points.length >= 3 && (
        <polygon
          points={o.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={o.color}
          fillOpacity={0.18}
          stroke={o.color}
          strokeWidth={0.6}
          strokeDasharray={o.dash}
        />
      )}
      {!o.filled && d && (
        <path
          d={d}
          fill="none"
          stroke={o.color}
          strokeWidth={0.8}
          strokeDasharray={o.dash}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {o.dots !== false &&
        o.points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={o.r ?? 1.4} fill={o.color} />
        ))}
    </g>
  );
}
