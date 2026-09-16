import { useState } from 'react';
import { CHECK_LABEL, CHECK_ORDER, KIND_LABEL, ROLE_LABEL } from '../domain/constants';
import { overallVerdict, pairVerdict } from '../domain/compare';
import { useStore, useStateSnapshot } from './StoreContext';
import { uid } from '../domain/fold';

export function HandoffTab({ identityId }: { identityId: string | null }) {
  const store = useStore();
  const state = useStateSnapshot();
  const elder = state.participants.find((p) => p.role === 'elder');
  const junior = state.participants.find((p) => p.role === 'junior');
  const witness = state.participants.find((p) => p.role === 'witness');
  const [witnessNote, setWitnessNote] = useState('');

  const allJoint = CHECK_ORDER.every((k) => state.checks[k].status === 'joint');
  const noDispute = CHECK_ORDER.every((k) => state.checks[k].status !== 'disputed');
  const kindsCovered = new Set(state.artifacts.map((a) => a.kind));
  const fourKinds = (['piece', 'pattern', 'threadCard', 'note'] as const).every((k) =>
    kindsCovered.has(k),
  );
  const noInvalidPair = state.pairings.every((p) => !p.invalidated);
  const noHardConflict = state.pairings.every((p) => {
    const v = overallVerdict(pairVerdict(p, state.statements, state.participants));
    return v !== 'conflict';
  });

  const gates = [
    { ok: !!elder && !!junior, label: '长辈与晚辈均已登记' },
    { ok: fourKinds, label: '绣片、描样纸、线卡、针法便签四类资料均已建档（至少各一件）' },
    { ok: state.artifacts.length > 0 && state.artifacts.every((a) => a.assetIds.length > 0), label: '每件资料均有图像依据' },
    { ok: allJoint, label: '四项核对均为双方共同确认' },
    { ok: noDispute, label: '不存在未化解的分歧' },
    { ok: noInvalidPair, label: '没有因证据修改而失效、尚未重核的配套' },
    { ok: noHardConflict, label: '配套比对中没有硬冲突（候选可保留并说明）' },
    { ok: state.handoffElderConfirmed && state.handoffJuniorConfirmed, label: '长辈与晚辈分别确认移交保管与续作责任' },
  ];

  if (state.frozen) {
    return <FrozenView />;
  }

  return (
    <div>
      <div className="panel">
        <h2>⑤ 闭合核对与责任移交</h2>
        <p className="hint">
          全部条件闭合后，由长辈与晚辈分别确认，资料保管与续作责任才转移给晚辈；见证家属可附见证意见。随后冻结版本：保留所有原声明、双方确认与分歧轨迹，只读可查。
        </p>
        <div style={{ marginTop: 8 }}>
          {gates.map((g, i) => (
            <div key={i} className="row" style={{ padding: '3px 0' }}>
              <span style={{ color: g.ok ? 'var(--green)' : 'var(--amber)' }}>{g.ok ? '✓' : '○'}</span>
              <span className={g.ok ? '' : 'hint'}>{g.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>逐项确认状态</h2>
        {CHECK_ORDER.map((k) => (
          <div key={k} className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span>{CHECK_LABEL[k]}</span>
            <span className="hint">{state.checks[k].confirmedBy.map((id) => state.participants.find((p) => p.id === id)?.name).join('、') || '—'}</span>
          </div>
        ))}
      </div>

      <div className="grid2">
        {[elder, junior].map((p) =>
          p ? (
            <div key={p.id} className="card">
              <b className={`badge ${p.role}`}>{ROLE_LABEL[p.role]} · {p.name}</b>
              <p className="hint" style={{ margin: '8px 0' }}>
                {p.role === 'elder'
                  ? '我确认资料与说明均已交代清楚，同意移交。'
                  : '我确认已接收全部资料，承担后续续作责任。'}
              </p>
              {p.role === 'elder' ? (
                state.handoffElderConfirmed ? (
                  <div className="row">
                    <span className="verdict matched">长辈已确认</span>
                    <button className="tiny ghost-danger" disabled={identityId !== p.id} onClick={() => store.append('handoffWithdrawn', { role: 'elder' }, p.id)}>
                      撤回
                    </button>
                  </div>
                ) : (
                  <button className="primary" disabled={identityId !== p.id} onClick={() => store.append('handoffConfirmed', { role: 'elder' }, p.id)}>
                    {identityId === p.id ? '我代表长辈确认移交' : '仅长辈本人可确认'}
                  </button>
                )
              ) : state.handoffJuniorConfirmed ? (
                <div className="row">
                  <span className="verdict matched">晚辈已确认</span>
                  <button className="tiny ghost-danger" disabled={identityId !== p.id} onClick={() => store.append('handoffWithdrawn', { role: 'junior' }, p.id)}>
                    撤回
                  </button>
                </div>
              ) : (
                <button className="primary" disabled={identityId !== p.id} onClick={() => store.append('handoffConfirmed', { role: 'junior' }, p.id)}>
                  {identityId === p.id ? '我代表晚辈确认接手' : '仅晚辈本人可确认'}
                </button>
              )}
            </div>
          ) : null,
        )}
      </div>

      {witness && (
        <div className="panel">
          <h2>见证家属意见（可选）</h2>
          <div className="row">
            <input
              placeholder="见证备注，如：在场看到全套资料清点移交"
              value={state.witnessAttestation?.note ?? witnessNote}
              disabled={!!state.witnessAttestation || identityId !== witness.id}
              style={{ flex: 1 }}
              onChange={(e) => setWitnessNote(e.target.value)}
            />
            {!state.witnessAttestation ? (
              <button
                disabled={identityId !== witness.id || !witnessNote.trim()}
                onClick={() =>
                  store.append(
                    'handoffWitnessed',
                    { witnessId: witness.id, note: witnessNote.trim(), attestationId: uid('att') },
                    witness.id,
                  )
                }
              >
                提交见证
              </button>
            ) : (
              <span className="verdict matched">
                已见证 · {new Date(state.witnessAttestation.at).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>冻结交接版本</h2>
        <p className="hint">
          冻结后本台只读：原声明、叠图配套、确认与分歧轨迹全部封存。硬冲突未排除时不允许冻结；「证据不足·候选」项可保留，作为续作中继续核实的线索。
        </p>
        <button
          className="primary"
          disabled={
            !allJoint ||
            !noDispute ||
            !noInvalidPair ||
            !noHardConflict ||
            !state.handoffElderConfirmed ||
            !state.handoffJuniorConfirmed ||
            !identityId
          }
          onClick={async () => {
            if (confirm('确认冻结？冻结后将无法再修改任何记录。')) {
              await store.freeze(identityId!);
            }
          }}
        >
          闭合并冻结，移交完成
        </button>
      </div>
    </div>
  );
}

function FrozenView() {
  const state = useStateSnapshot();
  return (
    <div>
      <div className="notice ok frozen-banner">
        <b>本交接版本已于 {state.frozenAt ? new Date(state.frozenAt).toLocaleString('zh-CN') : ''} 冻结封存。</b>
        <br />
        保管与续作责任已由长辈转移至晚辈。以下内容与全部原声明、分歧轨迹保持只读，可随时回看。
      </div>
      <div className="panel">
        <h2>封存清单</h2>
        {state.artifacts.map((a) => (
          <div key={a.id} className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span>
              <span className="badge">{KIND_LABEL[a.kind]}</span> {a.label}
            </span>
            <span className="hint">
              {a.assetIds.length} 张图像 ·{' '}
              {state.statements.filter((s) => s.artifactId === a.id).length} 条声明
            </span>
          </div>
        ))}
        <h3>四项核对结论</h3>
        {CHECK_ORDER.map((k) => (
          <div key={k} className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span>{CHECK_LABEL[k]}</span>
            <span className="verdict matched">双方共同确认</span>
          </div>
        ))}
        {state.witnessAttestation && (
          <>
            <h3>见证</h3>
            <div className="hint">
              {state.participants.find((p) => p.id === state.witnessAttestation!.witnessId)?.name}：
              {state.witnessAttestation.note}（{new Date(state.witnessAttestation.at).toLocaleString('zh-CN')}）
            </div>
          </>
        )}
      </div>
      <p className="hint">完整的操作与分歧轨迹见「记录轨迹」页；所有资料仅保存在本机浏览器 IndexedDB 中。</p>
    </div>
  );
}
