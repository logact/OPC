/**
 * ParticipantKind 不决定权限，只用于元数据展示。
 * 人与 agent 在 server 中具有同等的通信资格。
 */
export type ParticipantKind = 'human' | 'agent';

export interface Participant {
  id: string;
  kind: ParticipantKind;
  name: string;
  /** 扩展属性，如 avatar、capabilities、model 等 */
  metadata?: Record<string, unknown>;
}

export interface ParticipantCredentials {
  participantId: string;
  token: string;
}
