// 核心领域类型：事件溯源（event sourcing）。
// 所有操作都是不可变事件，折叠（fold）出当前状态；
// 冻结后仍可回看全部原声明与分歧轨迹。

export type Role = 'elder' | 'junior' | 'witness';
export type ArtifactKind = 'piece' | 'pattern' | 'threadCard' | 'note';
export type FeatureKey = 'grain' | 'holes' | 'outline' | 'threads' | 'fading' | 'missing';

/** 布纹方向：角度 0–359（纸样为图案正向；便签为文字正向） */
export interface GrainPayload {
  angle: number;
  note?: string;
}
export interface Pt {
  x: number; // 0–100 归一化坐标
  y: number;
}
/** 定位孔 */
export interface HolePayload {
  points: Pt[];
}
/** 已绣轮廓（折线点列） */
export interface OutlinePayload {
  open: boolean;
  points: Pt[];
}
export interface ThreadLine {
  code: string; // 线号
  color: string; // #rrggbb
  amount?: string; // 余量描述
}
/** 线卡：线号清单 */
export interface ThreadsPayload {
  lines: ThreadLine[];
}
/** 褪色区域 */
export interface FadingPayload {
  zones: { id: string; level: 'light' | 'medium' | 'heavy'; points: Pt[] }[];
}
/** 缺件 */
export interface MissingPayload {
  items: string[];
}

export type FeaturePayload =
  | GrainPayload
  | HolePayload
  | OutlinePayload
  | ThreadsPayload
  | FadingPayload
  | MissingPayload;

export interface Participant {
  id: string;
  name: string;
  role: Role;
  createdAt: number;
}

export interface Asset {
  id: string;
  projectId: string;
  artifactId?: string;
  kind: 'photo';
  name: string;
  dataUrl: string;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  label: string;
  createdAt: number;
  assetIds: string[];
}

export interface Statement {
  id: string;
  artifactId: string;
  feature: FeatureKey;
  authorId: string;
  version: number;
  payload: FeaturePayload;
  updatedAt: number;
}

export interface Transform {
  rotation: number; // 度
  tx: number; // 归一化平移
  ty: number;
  scale?: number;
}

export type RawVerdict = 'matched' | 'candidate' | 'conflict' | 'none';

export interface Pairing {
  id: string;
  /** 长辈侧物件（默认取长辈声明） */
  aId: string;
  /** 晚辈侧物件（默认取晚辈声明，叠加 transform 后比对） */
  bId: string;
  /** 可改取其他参与人的声明 */
  authorA?: string;
  authorB?: string;
  transform: Transform;
  /** 人工标记用于配套的特征（默认按类型自动） */
  features: FeatureKey[];
  invalidated: boolean;
  invalidReason?: string;
  createdAt: number;
}

export type CheckKey = 'ownership' | 'orientation' | 'startPoint' | 'leftovers';
export type CheckStatus = 'open' | 'partial' | 'joint' | 'disputed';

export interface DisputeRecord {
  id: string;
  participantId: string;
  reason: string;
  at: number;
  resolvedAt?: number;
}

export interface CheckState {
  status: CheckStatus;
  confirmedBy: string[]; // participant ids
  /** 进入分歧时的分歧轨迹（含已化解记录） */
  disputes: DisputeRecord[];
  /** 进入分歧前的上一共同状态快照 */
  lastJointStatus?: CheckStatus;
  lastJointConfirmedBy?: string[];
}

export type EventType =
  | 'projectCreated'
  | 'projectRenamed'
  | 'participantAdded'
  | 'artifactAdded'
  | 'artifactRemoved'
  | 'artifactRenamed'
  | 'assetAdded'
  | 'assetRemoved'
  | 'statementSet'
  | 'pairCreated'
  | 'pairRemoved'
  | 'pairInvalidated'
  | 'pairAuthorChanged'
  | 'pairFeatToggled'
  | 'pairXformChanged'
  | 'checkConfirmed'
  | 'checkWithdrawn'
  | 'checkDisputed'
  | 'checkResolved'
  | 'handoffConfirmed'
  | 'handoffWithdrawn'
  | 'handoffWitnessed'
  | 'frozen';

export interface DomainEvent {
  id: string;
  projectId: string;
  seq: number;
  type: EventType;
  at: number;
  actorId?: string;
  payload?: any;
}

export interface State {
  projectId: string;
  title: string;
  createdAt: number;
  frozen: boolean;
  frozenAt?: number;
  participants: Participant[];
  artifacts: Artifact[];
  statements: Statement[];
  pairings: Pairing[];
  checks: Record<CheckKey, CheckState>;
  handoffElderConfirmed: boolean;
  handoffJuniorConfirmed: boolean;
  witnessAttestation?: { witnessId: string; note: string; at: number };
  lastSeq: number;
}

export interface FrozenSummary {
  at: number;
  eventCount: number;
}
