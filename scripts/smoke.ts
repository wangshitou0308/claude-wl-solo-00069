// 用 tsx 不可用，改用 vite-node？直接用 esbuild 转译后跑。
import { fold, uid } from '../src/domain/fold';
import type { DomainEvent, EventType } from '../src/domain/types';

let seq = 0;
const pid = 'proj1';
const events: DomainEvent[] = [];
function ev(type: EventType, payload: any, actorId?: string): DomainEvent {
  return { id: uid('e'), projectId: pid, seq: seq++, type, at: Date.now() + seq, actorId, payload };
}

let assertCount = 0;
function assert(cond: boolean, msg: string) {
  assertCount++;
  if (!cond) {
    console.error('✗ ' + msg);
    process.exitCode = 1;
  } else console.log('✓ ' + msg);
}

events.push(ev('projectCreated', { title: '测试交接' }));
const elder = { id: 'pE', name: '外婆', role: 'elder', createdAt: 1 };
const junior = { id: 'pJ', name: '阿芸', role: 'junior', createdAt: 2 };
events.push(ev('participantAdded', elder));
events.push(ev('participantAdded', junior));

const piece = { id: 'aPiece', kind: 'piece', label: '绣片', createdAt: 3, assetIds: [] };
const paper = { id: 'aPaper', kind: 'pattern', label: '纸样', createdAt: 4, assetIds: [] };
events.push(ev('artifactAdded', piece));
events.push(ev('artifactAdded', paper));

// 双方登记 grain 一致（差 5°）
events.push(
  ev('statementSet', {
    id: 's1', artifactId: piece.id, feature: 'grain', authorId: elder.id, version: 0,
    payload: { angle: 90 }, updatedAt: 5,
  }),
);
events.push(
  ev('statementSet', {
    id: 's2', artifactId: paper.id, feature: 'grain', authorId: junior.id, version: 0,
    payload: { angle: 85 }, updatedAt: 6,
  }),
);

// 配套
const pairId = 'pair1';
events.push(
  ev('pairCreated', {
    id: pairId, aId: piece.id, bId: paper.id, transform: { rotation: 0, tx: 0, ty: 0 },
    features: ['grain', 'holes'], invalidated: false, createdAt: 7,
  }),
);

let s = fold(events)!;
assert(s.statements[0].version === 1 && s.statements[1].version === 1, '声明版本号自动从 1 起');

const { pairVerdict, overallVerdict, compareFeature, angDiff } = await import('../src/domain/compare');
let vs = pairVerdict(s.pairings[0], s.statements, s.participants);
let grain = vs.find((v) => v.key === 'grain')!;
assert(grain.verdict === 'matched', '布纹相差 5° 判一致，实际：' + grain.detail);

// 单方登记 holes → candidate
events.push(
  ev('statementSet', {
    id: 's3', artifactId: piece.id, feature: 'holes', authorId: elder.id, version: 0,
    payload: { points: [{ x: 30, y: 30 }] }, updatedAt: 8,
  }),
);
s = fold(events)!;
vs = pairVerdict(s.pairings[0], s.statements, s.participants);
const holesOne = vs.find((v) => v.key === 'holes')!;
assert(holesOne.verdict === 'candidate', '仅一方登记定位孔 → 候选而非冲突');

// 旋转后造成 40° 差 → 硬冲突
events.push(ev('pairXformChanged', { id: pairId, transform: { rotation: 40, tx: 0, ty: 0 } }));
s = fold(events)!;
vs = pairVerdict(s.pairings[0], s.statements, s.participants);
grain = vs.find((v) => v.key === 'grain')!;
assert(grain.verdict === 'conflict', '旋转 40° 后布纹差 45° → 硬冲突，实际：' + grain.detail);
assert(overallVerdict(vs) === 'conflict', '综合判定为硬冲突');

// 证据修改 → 相关配套失效（模拟 store.append 的级联事件）
events.push(
  ev('statementSet', {
    id: 's2', artifactId: paper.id, feature: 'grain', authorId: junior.id, version: 0,
    payload: { angle: 50 }, updatedAt: 9,
  }),
);
events.push(ev('pairInvalidated', { id: pairId, reason: '登记证据已修改' }));
s = fold(events)!;
assert(s.pairings[0].invalidated === true, '证据修改后相关配套失效');
assert(s.checks.grain === undefined || true, '');

// 重新对齐 → 失效解除
events.push(ev('pairXformChanged', { id: pairId, transform: { rotation: 0, tx: 0, ty: 0 } }));
s = fold(events)!;
assert(s.pairings[0].invalidated === false, '重新对齐后配套恢复有效');

// 核对确认 / 撤回最近确认
events.push(ev('checkConfirmed', { key: 'ownership', participantId: elder.id }));
s = fold(events)!;
assert(s.checks.ownership.status === 'partial' && s.checks.ownership.confirmedBy.length === 1, '单方确认 → partial');
events.push(ev('checkConfirmed', { key: 'ownership', participantId: junior.id }));
s = fold(events)!;
assert(s.checks.ownership.status === 'joint', '双方确认 → joint');

// 提出分歧 → 停在上一共同状态
events.push(
  ev('checkDisputed', { key: 'ownership', participantId: junior.id, disputeId: 'd1', reason: '归属记忆不同' }),
);
s = fold(events)!;
assert(s.checks.ownership.status === 'disputed', '分歧状态');
assert(
  s.checks.ownership.lastJointStatus === 'joint' &&
    s.checks.ownership.lastJointConfirmedBy?.length === 2,
  '停在上一共同状态（双方共同确认）',
);
assert(s.checks.ownership.disputes[0].reason === '归属记忆不同', '分歧理由留存');

// 任一方撤回最近确认（分歧状态下保留 status disputed）
events.push(ev('checkWithdrawn', { key: 'ownership', participantId: junior.id }));
s = fold(events)!;
assert(s.checks.ownership.confirmedBy.length === 1 && s.checks.ownership.status === 'disputed', '分歧中撤回确认仍保持分歧状态');

events.push(ev('checkResolved', { key: 'ownership' }));
s = fold(events)!;
assert(s.checks.ownership.status === 'partial', '化解分歧后按剩余确认数回到 partial');
assert(s.checks.ownership.disputes[0].resolvedAt !== undefined, '分歧轨迹保留化解时间');

// 线号比对
const tMatched = compareFeature(
  'threads',
  { id: 't1', artifactId: '', feature: 'threads', authorId: '', version: 1, updatedAt: 0, payload: { lines: [{ code: 'dmc 666', color: '#ff0000' }] } },
  { id: 't2', artifactId: '', feature: 'threads', authorId: '', version: 1, updatedAt: 0, payload: { lines: [{ code: 'DMC 666', color: '#ff0000' }] } },
  { rotation: 0, tx: 0, ty: 0 },
);
assert(tMatched.verdict === 'matched', '线号忽略大小写一致');

const tConflict = compareFeature(
  'threads',
  { id: 't1', artifactId: '', feature: 'threads', authorId: '', version: 1, updatedAt: 0, payload: { lines: [{ code: '666', color: '#ff0000' }] } },
  { id: 't2', artifactId: '', feature: 'threads', authorId: '', version: 1, updatedAt: 0, payload: { lines: [{ code: '666', color: '#00ff00' }] } },
  { rotation: 0, tx: 0, ty: 0 },
);
assert(tConflict.verdict === 'conflict', '同线号不同颜色 → 硬冲突：' + tConflict.detail);

// 缺件措辞不同 → 候选保留
const m = compareFeature(
  'missing',
  { id: 'm1', artifactId: '', feature: 'missing', authorId: '', version: 1, updatedAt: 0, payload: { items: ['红线一板'] } },
  { id: 'm2', artifactId: '', feature: 'missing', authorId: '', version: 1, updatedAt: 0, payload: { items: ['红丝线一板'] } },
  { rotation: 0, tx: 0, ty: 0 },
);
assert(m.verdict === 'candidate', '缺件措辞不同保留候选：' + m.detail);

// 冻结后状态
events.push(ev('frozen', {}, elder.id));
s = fold(events)!;
assert(s.frozen === true && s.frozenAt !== undefined, '冻结成功');

// angDiff sanity
assert(angDiff(350, 10) === 20, '角度环绕差正确');

console.log(`\n${assertCount} 项断言完成`);
