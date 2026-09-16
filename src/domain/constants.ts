import type {
  ArtifactKind,
  CheckKey,
  CheckState,
  FeatureKey,
  Role,
} from './types';

export const ROLE_LABEL: Record<Role, string> = {
  elder: '长辈',
  junior: '晚辈',
  witness: '见证家属',
};

export const KIND_LABEL: Record<ArtifactKind, string> = {
  piece: '绣片',
  pattern: '描样纸',
  threadCard: '线卡',
  note: '针法便签',
};

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  grain: '布纹方向',
  holes: '定位孔',
  outline: '已绣轮廓',
  threads: '线号',
  fading: '褪色',
  missing: '缺件',
};

/** 各类资料需要登记的特征 */
export const KIND_FEATURES: Record<ArtifactKind, FeatureKey[]> = {
  piece: ['grain', 'holes', 'outline', 'fading', 'missing'],
  pattern: ['grain', 'holes', 'missing'],
  threadCard: ['threads', 'fading', 'missing'],
  note: ['grain', 'outline', 'missing'],
};

export const CHECK_LABEL: Record<CheckKey, string> = {
  ownership: '实物归属',
  orientation: '纸样朝向',
  startPoint: '续针起点',
  leftovers: '余料',
};

export const CHECK_FEATURES: Record<CheckKey, FeatureKey[]> = {
  ownership: ['missing', 'outline'],
  orientation: ['grain', 'holes'],
  startPoint: ['outline', 'holes'],
  leftovers: ['threads', 'fading', 'missing'],
};

export const CHECK_ORDER: CheckKey[] = [
  'ownership',
  'orientation',
  'startPoint',
  'leftovers',
];

export function emptyChecks(): Record<CheckKey, CheckState> {
  const mk = (): CheckState => ({ status: 'open', confirmedBy: [], disputes: [] });
  return {
    ownership: mk(),
    orientation: mk(),
    startPoint: mk(),
    leftovers: mk(),
  };
}

export const VERDICT_LABEL = {
  matched: '一致',
  candidate: '证据不足·候选',
  conflict: '硬冲突',
  none: '未比对',
} as const;
