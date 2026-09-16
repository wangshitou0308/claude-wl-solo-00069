import { useMemo, useState } from 'react';
import type { CheckKey } from '../domain/types';
import {
  CHECK_FEATURES,
  CHECK_LABEL,
  CHECK_ORDER,
  FEATURE_LABEL,
  KIND_LABEL,
  ROLE_LABEL,
} from '../domain/constants';
import { overallVerdict, pairVerdict } from '../domain/compare';
import { useStore, useStateSnapshot } from './StoreContext';
import { uid } from '../domain/fold';

export function CheckTab({ identityId }: { identityId: string | null }) {
  const state = useStateSnapshot();
  const elder = state.participants.find((p) => p.role === 'elder');
  const junior = state.participants.find((p) => p.role === 'junior');

  if (!elder || !junior)
    return <div className="notice info">请先在「登记」页登记长辈与晚辈，再开始逐件核对。</div>;

  return (
    <div>
      <div className="panel">
        <h2>④ 双方逐件核对</h2>
        <p className="hint">
          四项分别由长辈、晚辈各自确认；意见不一致可提出分歧，系统停在上一共同状态并回看对应图像依据。任何一方都能撤回自己最近的确认；证据修改只会让相关配套失效，已作出的确认不自动抹掉。
        </p>
      </div>
      {CHECK_ORDER.map((key) => (
        <CheckCard key={key} checkKey={key} identityId={identityId} />
      ))}
    </div>
  );
}

const STATUS_TEXT = {
  open: '未确认',
  partial: '单方已确认',
  joint: '双方共同确认',
  disputed: '存在分歧',
} as const;

function CheckCard({ checkKey, identityId }: { checkKey: CheckKey; identityId: string | null }) {
  const store = useStore();
  const state = useStateSnapshot();
  const check = state.checks[checkKey];
  const [reason, setReason] = useState('');
  const [showEvidence, setShowEvidence] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);

  const elder = state.participants.find((p) => p.role === 'elder')!;
  const junior = state.participants.find((p) => p.role === 'junior')!;
  const sides = [elder, junior];

  // 本项相关的配套判定
  const relevant = useMemo(() => {
    return state.pairings.map((p) => {
      const all = pairVerdict(p, state.statements, state.participants);
      const verdicts = all.filter((v) => CHECK_FEATURES[checkKey].includes(v.key));
      return { pair: p, verdicts, overall: overallVerdict(verdicts) };
    });
  }, [state.pairings, state.statements, state.participants, checkKey]);

  const nameOf = (id: string) => state.participants.find((p) => p.id === id)?.name ?? id;
  const roleBadge = (id: string) => {
    const role = state.participants.find((p) => p.id === id)?.role;
    return role ? ROLE_LABEL[role] : '';
  };

  const photos = useMemo(() => {
    const ids = new Set<string>();
    state.pairings.forEach((p) => {
      [p.aId, p.bId].forEach((aid) => {
        const art = state.artifacts.find((a) => a.id === aid);
        art?.assetIds.forEach((x) => ids.add(x));
      });
    });
    return [...ids].map((id) => store.getAsset(id)).filter(Boolean) as NonNullable<
      ReturnType<typeof store.getAsset>
    >[];
  }, [state, checkKey, store]);

  const activeDispute = check.disputes.filter((d) => !d.resolvedAt).slice(-1)[0];

  async function confirm(pid: string) {
    if (check.status === 'disputed') {
      alert('当前处于分歧状态：请先化解分歧（补充证据或撤回本方确认），再重新确认。');
      return;
    }
    await store.append('checkConfirmed', { key: checkKey, participantId: pid }, pid);
  }

  async function withdraw(pid: string) {
    await store.append('checkWithdrawn', { key: checkKey, participantId: pid }, pid);
  }

  async function raiseDispute(pid: string) {
    if (!reason.trim()) {
      alert('请写明分歧所在，例如「纸样顶部花纹与绣片方向相差约 30°」。');
      return;
    }
    await store.append(
      'checkDisputed',
      { key: checkKey, participantId: pid, disputeId: uid('dsp'), reason: reason.trim() },
      pid,
    );
    setReason('');
  }

  async function resolve() {
    if (identityId) await store.append('checkResolved', { key: checkKey }, identityId);
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{CHECK_LABEL[checkKey]}</h2>
        <span
          className={`verdict ${
            check.status === 'joint'
              ? 'matched'
              : check.status === 'disputed'
                ? 'conflict'
                : check.status === 'partial'
                  ? 'candidate'
                  : 'none'
          }`}
        >
          {STATUS_TEXT[check.status]}
        </span>
      </div>

      {/* 上一共同状态 */}
      {check.status === 'disputed' && check.lastJointConfirmedBy && (
        <div className="notice error" style={{ marginTop: 10 }}>
          已停在上一共同状态：
          {check.lastJointConfirmedBy.length
            ? check.lastJointConfirmedBy.map(nameOf).join('、') + ' 曾确认'
            : '双方均未确认'}
          。当前证据未被改写，请回看图像与叠图依据后再决定。
        </div>
      )}

      {/* 相关配套判定 */}
      <div style={{ marginTop: 10 }}>
        {relevant.length === 0 && <div className="hint">尚未建立任何配套，可先到「叠图配套」页对齐。</div>}
        {relevant.map(({ pair, verdicts, overall }) => {
          const a = state.artifacts.find((x) => x.id === pair.aId);
          const b = state.artifacts.find((x) => x.id === pair.bId);
          const shown = verdicts.filter((v) => CHECK_FEATURES[checkKey].includes(v.key));
          return (
            <div key={pair.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
              <span className="hint">
                {a ? `${KIND_LABEL[a.kind]}·${a.label}` : '（已删除）'} ⇄{' '}
                {b ? `${KIND_LABEL[b.kind]}·${b.label}` : '（已删除）'}
                {pair.invalidated && '（配套已失效）'}
              </span>
              <span className="row">
                {shown.map((v) => (
                  <span key={v.key} className="hint" title={v.detail}>
                    {FEATURE_LABEL[v.key]}
                    <span className={`verdict ${v.verdict}`} style={{ marginLeft: 4 }}>
                      {v.verdict === 'matched' ? '一致' : v.verdict === 'conflict' ? '冲突' : '候选'}
                    </span>
                  </span>
                ))}
                {shown.length > 1 && <span className={`verdict ${pair.invalidated ? 'none' : overall}`}>综合</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* 双方各自确认 / 撤回 */}
      <div className="grid2" style={{ marginTop: 10 }}>
        {sides.map((p) => {
          const confirmed = check.confirmedBy.includes(p.id);
          const isMe = identityId === p.id;
          return (
            <div key={p.id} className="card" style={{ background: confirmed ? '#f4f9f4' : '#fff' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className={`badge ${p.role}`}>
                  {ROLE_LABEL[p.role]} · {p.name}
                </b>
                {confirmed ? <span className="verdict matched">已确认</span> : <span className="verdict none">未确认</span>}
              </div>
              {!state.frozen && (
                <div className="row" style={{ marginTop: 8 }}>
                  {!confirmed ? (
                    <button className="primary tiny" disabled={!isMe || check.status === 'disputed'} onClick={() => confirm(p.id)}>
                      {isMe ? '我确认本项一致' : '仅本人可确认'}
                    </button>
                  ) : (
                    <button className="tiny ghost-danger" disabled={!isMe} onClick={() => withdraw(p.id)}>
                      撤回我方确认
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 分歧 */}
      {!state.frozen && (
        <div style={{ marginTop: 10 }}>
          {check.status !== 'disputed' ? (
            <div className="row">
              <input
                placeholder="若有不同意见，写明分歧点后提出（不确认时使用）"
                value={reason}
                style={{ flex: 1 }}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                disabled={!identityId || !reason.trim()}
                onClick={() => identityId && raiseDispute(identityId)}
              >
                提出分歧
              </button>
            </div>
          ) : (
            <button className="primary" disabled={!identityId} onClick={resolve}>
              双方已重新对齐，化解分歧
            </button>
          )}
        </div>
      )}

      {/* 分歧轨迹 */}
      {check.disputes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h3 style={{ marginTop: 4 }}>分歧轨迹（冻结后仍保留）</h3>
          {check.disputes.map((d) => (
            <div key={d.id} className="timeline-item">
              <b>{roleBadge(d.participantId)} {nameOf(d.participantId)}</b>{' '}
              <span className="time">{new Date(d.at).toLocaleString('zh-CN')}</span>
              <div>{d.reason}</div>
              {d.resolvedAt && <span className="badge" style={{ marginTop: 4 }}>已于 {new Date(d.resolvedAt).toLocaleString('zh-CN')} 化解</span>}
            </div>
          ))}
          {activeDispute && <div className="hint">当前分歧：{activeDispute.reason}</div>}
        </div>
      )}

      {/* 回看图像依据 */}
      {photos.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button className="tiny" onClick={() => setShowEvidence((v) => !v)}>
            {showEvidence ? '收起图像依据' : '回看图像依据'}
          </button>
          {showEvidence && (
            <div style={{ marginTop: 8 }}>
              <img
                src={photos[photoIdx % photos.length].dataUrl}
                alt="图像依据"
                style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8, border: '1px solid var(--line)' }}
              />
              <div className="row" style={{ marginTop: 6 }}>
                <button className="tiny" onClick={() => setPhotoIdx((i) => (i + photos.length - 1) % photos.length)}>
                  上一张
                </button>
                <span className="hint">
                  {photoIdx + 1} / {photos.length} · {photos[photoIdx % photos.length].name}
                </span>
                <button className="tiny" onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}>
                  下一张
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
