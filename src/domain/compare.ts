import type {
  FeatureKey,
  FeaturePayload,
  Pairing,
  Participant,
  Pt,
  RawVerdict,
  Statement,
  Transform,
} from './types';

const DEG = Math.PI / 180;

export function angDiff(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

/** 旋转后归一化坐标（viewBox 0 0 100 100，中心旋转） */
export function transformPoint(p: Pt, t: Transform): Pt {
  const a = -t.rotation * DEG;
  const cx = 50 + t.tx;
  const cy = 50 + t.ty;
  const s = t.scale ?? 1;
  const dx = (p.x - 50) * s;
  const dy = (p.y - 50) * s;
  return {
    x: cx + dx * Math.cos(a) - dy * Math.sin(a),
    y: cy + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 点到折线的最近距离 */
function pointToPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    let t = len2 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    best = Math.min(best, dist(p, q));
  }
  return best;
}

/** 折线间平均距离（双向最近点均值） */
function polylineDistance(l1: Pt[], l2: Pt[]): number {
  if (!l1.length || !l2.length) return 0;
  let sum = 0;
  for (const p of l1) sum += pointToPolyline(p, l2);
  for (const p of l2) sum += pointToPolyline(p, l1);
  return sum / (l1.length + l2.length);
}

function polygonCentroid(pts: Pt[]): Pt {
  if (!pts.length) return { x: 50, y: 50 };
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

function normAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export interface FeatureVerdict {
  key: FeatureKey;
  verdict: RawVerdict;
  detail: string;
}

/**
 * 单特征比对。原则：
 * - 双方都有证据 → 比较
 * - 仅一方有证据，另一方无任何声明 → candidate（保留候选，不判冲突）
 * - 阈值内 matched；超出硬阈值 conflict；中间区域 candidate（证据不足）
 */
export function compareFeature(
  key: FeatureKey,
  elder: Statement | undefined,
  junior: Statement | undefined,
  transform: Transform,
): FeatureVerdict {
  const hasE = !!elder;
  const hasJ = !!junior;
  if (!hasE || !hasJ) {
    return {
      key,
      verdict: 'candidate',
      detail: hasE ? '仅长辈登记' : '仅晚辈登记',
    };
  }
  const pa = elder.payload;
  const pb = junior.payload;

  switch (key) {
    case 'grain': {
      const aa = normAngle((pa as any).angle);
      const ab = normAngle((pb as any).angle + transform.rotation);
      const d = angDiff(aa, ab);
      if (d <= 8) return { key, verdict: 'matched', detail: `角度差 ${d.toFixed(0)}°` };
      if (d <= 20) return { key, verdict: 'candidate', detail: `角度差 ${d.toFixed(0)}°，待核` };
      return { key, verdict: 'conflict', detail: `角度差 ${d.toFixed(0)}°` };
    }
    case 'holes': {
      const ha = (pa as any).points as Pt[];
      const hbRaw = (pb as any).points as Pt[];
      if (!ha.length || !hbRaw.length)
        return { key, verdict: 'candidate', detail: '一方未点定位孔' };
      const hb = hbRaw.map((p) => transformPoint(p, transform));
      // 贪心配对
      const used = new Set<number>();
      let matchedCount = 0;
      let maxGap = 0;
      let sumGap = 0;
      for (const p of ha) {
        let bi = -1;
        let bd = Infinity;
        hb.forEach((q, i) => {
          if (!used.has(i) && dist(p, q) < bd) {
            bd = dist(p, q);
            bi = i;
          }
        });
        if (bi >= 0) {
          used.add(bi);
          maxGap = Math.max(maxGap, bd);
          sumGap += bd;
          if (bd <= 6) matchedCount++;
        }
      }
      const countMismatch = ha.length !== hbRaw.length;
      const avg = sumGap / Math.max(1, ha.length);
      if (countMismatch || maxGap > 14)
        return {
          key,
          verdict: 'conflict',
          detail: `${ha.length} 孔对 ${hbRaw.length} 孔，最大偏差 ${maxGap.toFixed(1)}`,
        };
      if (maxGap <= 6)
        return { key, verdict: 'matched', detail: `${matchedCount} 孔吻合，偏差 ≤6` };
      return { key, verdict: 'candidate', detail: `平均偏差 ${avg.toFixed(1)}，待精对齐` };
    }
    case 'outline': {
      const la = (pa as any).points as Pt[];
      const lb = ((pb as any).points as Pt[]).map((p) => transformPoint(p, transform));
      if (la.length < 2 || lb.length < 2)
        return { key, verdict: 'candidate', detail: '一方轮廓点不足' };
      const d = polylineDistance(la, lb);
      if (d <= 7) return { key, verdict: 'matched', detail: `轮廓贴合偏差 ${d.toFixed(1)}` };
      if (d <= 15) return { key, verdict: 'candidate', detail: `偏差 ${d.toFixed(1)}，待对齐` };
      return { key, verdict: 'conflict', detail: `轮廓偏差 ${d.toFixed(1)}` };
    }
    case 'threads': {
      const la = ((pa as any).lines ?? []) as { code: string; color: string }[];
      const lb = ((pb as any).lines ?? []) as { code: string; color: string }[];
      if (!la.length || !lb.length)
        return { key, verdict: 'candidate', detail: '一方无线号记录' };
      const setB = new Map(lb.map((l) => [l.code.trim().toUpperCase(), l.color]));
      const missing: string[] = [];
      const colorMismatch: string[] = [];
      for (const l of la) {
        const cb = setB.get(l.code.trim().toUpperCase());
        if (cb === undefined) missing.push(l.code);
        else if (cb.toLowerCase() !== l.color.toLowerCase()) colorMismatch.push(l.code);
      }
      const extra = lb
        .map((l) => l.code)
        .filter((c) => !la.some((x) => x.code.trim().toUpperCase() === c.trim().toUpperCase()));
      if (colorMismatch.length)
        return {
          key,
          verdict: 'conflict',
          detail: `线号颜色不符：${colorMismatch.join('、')}`,
        };
      if (missing.length || extra.length)
        return {
          key,
          verdict: 'candidate',
          detail: `线号集合差异：缺 ${missing.join('、') || '—'}；多 ${extra.join('、') || '—'}`,
        };
      return { key, verdict: 'matched', detail: `${la.length} 个线号一致` };
    }
    case 'fading': {
      const za = ((pa as any).zones ?? []) as {
        level: string;
        points: Pt[];
      }[];
      const zb = ((pb as any).zones ?? []) as { level: string; points: Pt[] }[];
      if (!za.length && !zb.length)
        return { key, verdict: 'matched', detail: '双方均未报褪色' };
      if (!za.length || !zb.length)
        return { key, verdict: 'candidate', detail: '仅一方标记褪色' };
      // 质心距离 + 等级
      const ca = polygonCentroid(za[0].points);
      const cb0 = polygonCentroid(zb[0].points);
      const cb = transformPoint(cb0, transform);
      const d = dist(ca, cb);
      if (za[0].level !== zb[0].level)
        return { key, verdict: 'conflict', detail: '褪色程度判断不同' };
      if (d <= 12) return { key, verdict: 'matched', detail: `褪色区位一致（${za[0].level}）` };
      if (d <= 22) return { key, verdict: 'candidate', detail: '褪色区位置待核' };
      return { key, verdict: 'conflict', detail: '褪色区位置不一致' };
    }
    case 'missing': {
      const ia = ((pa as any).items ?? []) as string[];
      const ib = ((pb as any).items ?? []) as string[];
      const norm = (s: string) => s.trim();
      const setA = new Set(ia.map(norm).filter(Boolean));
      const setB = new Set(ib.map(norm).filter(Boolean));
      if (!setA.size && !setB.size)
        return { key, verdict: 'matched', detail: '双方均称无缺件' };
      const onlyA = [...setA].filter((x) => !setB.has(x));
      const onlyB = [...setB].filter((x) => !setA.has(x));
      if (!onlyA.length && !onlyB.length)
        return { key, verdict: 'matched', detail: `缺件清单一致（${setA.size} 项）` };
      // 缺件是记忆冲突高发区：措辞可能不同，先保留候选而非硬冲突
      return {
        key,
        verdict: 'candidate',
        detail: `缺件说法不同：长辈「${onlyA.join('、') || '无'}」／晚辈「${
          onlyB.join('、') || '无'
        }」`,
      };
    }
  }
}

/** 在某物件某特征的若干声明中，按角色优先级取声明 */
export function pickStatement(
  statements: Statement[],
  artifactId: string,
  feature: FeatureKey,
  preferredAuthorId: string | undefined,
  participants: Participant[],
  preferRole: 'elder' | 'junior',
): Statement | undefined {
  const all = statements.filter((s) => s.artifactId === artifactId && s.feature === feature);
  if (!all.length) return undefined;
  if (preferredAuthorId) {
    const explicit = all.find((s) => s.authorId === preferredAuthorId);
    if (explicit) return explicit;
  }
  const roleOf = (id: string) => participants.find((p) => p.id === id)?.role;
  const byRole = (role: string) => all.find((s) => roleOf(s.authorId) === role);
  return byRole(preferRole) ?? all[0];
}

export function pairVerdict(
  pair: Pairing,
  statements: Statement[],
  participants: Participant[],
): FeatureVerdict[] {
  return pair.features.map((f) => {
    const elder = pickStatement(
      statements,
      pair.aId,
      f,
      pair.authorA,
      participants,
      'elder',
    );
    const junior = pickStatement(
      statements,
      pair.bId,
      f,
      pair.authorB,
      participants,
      'junior',
    );
    return compareFeature(f, elder, junior, pair.transform);
  });
}

export function overallVerdict(vs: FeatureVerdict[]): RawVerdict {
  if (!vs.length) return 'none';
  if (vs.some((v) => v.verdict === 'conflict')) return 'conflict';
  if (vs.every((v) => v.verdict === 'matched')) return 'matched';
  return 'candidate';
}

export type { FeaturePayload };
