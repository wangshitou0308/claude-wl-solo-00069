import { useState } from 'react';
import type { DomainEvent, State } from '../domain/types';
import { CHECK_LABEL, FEATURE_LABEL, KIND_LABEL } from '../domain/constants';
import { useStore } from './StoreContext';

export function HistoryTab() {
  const store = useStore();
  const state = store.getState()!;
  const [onlyDisputes, setOnlyDisputes] = useState(false);

  const events = [...store.getEvents()].reverse();
  const shown = onlyDisputes
    ? events.filter((e) => e.type === 'checkDisputed' || e.type === 'checkResolved')
    : events;

  return (
    <div className="panel">
      <h2>记录轨迹</h2>
      <p className="hint">
        事件只追加、不可改写；冻结后仍完整可查。共 {events.length} 条，由浏览器 IndexedDB 本地保存。
      </p>
      <div className="row" style={{ margin: '8px 0 14px' }}>
        <label className="hint">
          <input type="checkbox" checked={onlyDisputes} onChange={(e) => setOnlyDisputes(e.target.checked)} />{' '}
          只看分歧提出与化解
        </label>
      </div>
      {shown.map((e) => (
        <div key={e.id} className="timeline-item">
          <div>
            {describe(e, state)}
            {e.actorId && (
              <span className="hint"> —— {state.participants.find((p) => p.id === e.actorId)?.name ?? '某人'}</span>
            )}
          </div>
          <div className="time">#{e.seq} · {new Date(e.at).toLocaleString('zh-CN')} · {e.type}</div>
        </div>
      ))}
    </div>
  );
}

function describe(e: DomainEvent, state: State): string {
  const p = e.payload ?? {};
  const artifact = (id: string) => {
    const a = state.artifacts.find((x: any) => x.id === id);
    return a ? `${KIND_LABEL[a.kind]}「${a.label}」` : '一件资料';
  };
  switch (e.type) {
    case 'projectCreated':
      return `创建交接台「${p.title}」`;
    case 'projectRenamed':
      return `项目改名为「${p.title}」`;
    case 'participantAdded':
      return `登记参与人：${p.name}`;
    case 'artifactAdded':
      return `建档：${KIND_LABEL[p.kind as keyof typeof KIND_LABEL]}「${p.label}」`;
    case 'artifactRemoved':
      return `删除资料：${artifact(p.id)}`;
    case 'artifactRenamed':
      return `资料改名：「${p.label}」`;
    case 'assetAdded':
      return `${artifact(p.artifactId)} 新增图像依据「${p.name}」`;
    case 'assetRemoved':
      return `移除一张图像依据`;
    case 'statementSet':
      return `${artifact(p.artifactId)} 登记/修改「${FEATURE_LABEL[p.feature as keyof typeof FEATURE_LABEL]}」`;
    case 'pairCreated': {
      const a = state.artifacts.find((x: any) => x.id === p.aId);
      const b = state.artifacts.find((x: any) => x.id === p.bId);
      return `建立配套：${a?.label ?? '资料'} ⇄ ${b?.label ?? '资料'}`;
    }
    case 'pairRemoved':
      return `解除一套配套`;
    case 'pairInvalidated':
      return `配套因证据变化自动失效（${p.reason}）`;
    case 'pairAuthorChanged':
      return `调整配套取声明的参与人`;
    case 'pairFeatToggled':
      return `配套比对特征调整：${FEATURE_LABEL[p.feature as keyof typeof FEATURE_LABEL]}`;
    case 'pairXformChanged':
      return `叠图重新对齐（旋转 ${p.transform?.rotation}°）`;
    case 'checkConfirmed':
      return `确认「${CHECK_LABEL[p.key as keyof typeof CHECK_LABEL]}」`;
    case 'checkWithdrawn':
      return `撤回对「${CHECK_LABEL[p.key as keyof typeof CHECK_LABEL]}」的确认`;
    case 'checkDisputed':
      return `就「${CHECK_LABEL[p.key as keyof typeof CHECK_LABEL]}」提出分歧：${p.reason}`;
    case 'checkResolved':
      return `化解「${CHECK_LABEL[p.key as keyof typeof CHECK_LABEL]}」的分歧`;
    case 'handoffConfirmed':
      return p.role === 'elder' ? '长辈确认移交' : '晚辈确认接手';
    case 'handoffWithdrawn':
      return p.role === 'elder' ? '长辈撤回移交确认' : '晚辈撤回收接确认';
    case 'handoffWitnessed':
      return `见证家属意见：${p.note}`;
    case 'frozen':
      return '冻结交接版本，责任移交完成';
    default:
      return e.type;
  }
}
