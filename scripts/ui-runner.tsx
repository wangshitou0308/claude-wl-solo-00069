// 无浏览器环境下的组件渲染冒烟（CJS，单一 React 副本）：
// 打桩 useSyncExternalStore 的 SSR 快照，用 react-dom/server 渲染全部标签页。
import React from 'react';
import { renderToString } from 'react-dom/server';
import { fold, uid } from '../src/domain/fold';
import type { DomainEvent, EventType } from '../src/domain/types';
import type { ProjectStore } from '../src/data/store';
import { StoreProvider } from '../src/app/StoreContext';
import { RegisterTab } from '../src/app/RegisterTab';
import { AlignmentTab } from '../src/app/AlignmentTab';
import { CheckTab } from '../src/app/CheckTab';
import { HandoffTab } from '../src/app/HandoffTab';
import { HistoryTab } from '../src/app/HistoryTab';

async function main() {
  // SSR 下 useSyncExternalStore 取 getServerSnapshot；打桩为取 getSnapshot，模拟客户端
  (React as any).useSyncExternalStore = ((_subscribe: () => void, getSnapshot: () => unknown) =>
    getSnapshot()) as typeof React.useSyncExternalStore;

  let seq = 0;
  const events: DomainEvent[] = [];
  const ev = (type: EventType, payload: any, actorId?: string): DomainEvent => ({
    id: uid('e'),
    projectId: 'p',
    seq: seq++,
    type,
    at: Date.now() + seq,
    actorId,
    payload,
  });

  events.push(ev('projectCreated', { title: '冒烟交接' }));
  events.push(ev('participantAdded', { id: 'e1', name: '外婆', role: 'elder', createdAt: 1 }));
  events.push(ev('participantAdded', { id: 'j1', name: '阿芸', role: 'junior', createdAt: 2 }));
  events.push(ev('artifactAdded', { id: 'piece', kind: 'piece', label: '牡丹绣片', createdAt: 3, assetIds: [] }));
  events.push(ev('artifactAdded', { id: 'paper', kind: 'pattern', label: '牡丹纸样', createdAt: 4, assetIds: [] }));
  events.push(
    ev('statementSet', {
      id: 's1', artifactId: 'piece', feature: 'grain', authorId: 'e1', version: 0,
      payload: { angle: 0 }, updatedAt: 5,
    }),
  );
  events.push(
    ev('statementSet', {
      id: 's2', artifactId: 'paper', feature: 'grain', authorId: 'j1', version: 0,
      payload: { angle: 0 }, updatedAt: 6,
    }),
  );
  events.push(
    ev('pairCreated', {
      id: 'pair1', aId: 'piece', bId: 'paper',
      transform: { rotation: 0, tx: 0, ty: 0, scale: 1 },
      features: ['grain', 'holes'], invalidated: false, createdAt: 7,
    }),
  );
  events.push(ev('checkConfirmed', { key: 'ownership', participantId: 'e1' }));
  events.push(
    ev('checkDisputed', { key: 'orientation', participantId: 'j1', disputeId: 'd1', reason: '朝向记忆不符' }),
  );

  const state = fold(events)!;
  const store = {
    getState: () => state,
    subscribe: () => () => {},
    getAsset: () => undefined,
    getEvents: () => events,
    append: async () => {},
  } as unknown as ProjectStore;

  const render = (el: React.ReactNode) =>
    renderToString(<StoreProvider store={store}>{el}</StoreProvider>);

  const checks: [string, boolean][] = [
    ['登记页含物件名', render(<RegisterTab identityId="e1" />).includes('牡丹绣片')],
    ['配套页含逐特征判定', render(<AlignmentTab identityId="e1" />).includes('逐项判定')],
    ['核对页含分歧轨迹', render(<CheckTab identityId="e1" />).includes('分歧轨迹')],
    ['移交页含闭合条件', render(<HandoffTab identityId="e1" />).includes('闭合核对与责任移交')],
    ['轨迹页含事件描述', render(<HistoryTab />).includes('提出分歧')],
  ];

  let fail = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '✓ ' : '✗ ') + name);
    if (!ok) fail++;
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
