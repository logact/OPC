import { ParticipantKindSchema } from '@logact-pub/opc-protocol';
import type { ParticipantKind } from '@logact-pub/opc-protocol';

// kind 字面量列表的唯一来源是 protocol 的 ParticipantKindSchema，这里派生而非重复定义
export const participantKind = Object.fromEntries(
  ParticipantKindSchema.options.map((kind) => [kind, kind])
) as { [K in ParticipantKind]: K };
