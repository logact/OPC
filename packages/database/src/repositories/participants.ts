import { eq } from 'drizzle-orm';
import type { Participant as CoreParticipant } from '@opc/core';
import type { DbClient } from '../client/index.js';
import { participants } from '../schema/index.js';

export function createParticipantRepository(db: DbClient) {
  return {
    async ensure(
      id: string,
      name?: string,
      kind: CoreParticipant['kind'] = 'human'
    ): Promise<CoreParticipant> {
      const existing = await db.query.participants.findFirst({
        where: eq(participants.id, id),
      });

      if (existing) {
        return {
          id: existing.id,
          kind: existing.kind,
          name: existing.name,
          metadata: existing.metadata ?? undefined,
        };
      }

      const [created] = await db
        .insert(participants)
        .values({ id, kind, name: name ?? id })
        .returning();

      return {
        id: created.id,
        kind: created.kind,
        name: created.name,
        metadata: created.metadata ?? undefined,
      };
    },

    async findById(id: string): Promise<CoreParticipant | undefined> {
      const row = await db.query.participants.findFirst({
        where: eq(participants.id, id),
      });
      if (!row) return undefined;
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        metadata: row.metadata ?? undefined,
      };
    },
  };
}

export type ParticipantRepository = ReturnType<typeof createParticipantRepository>;
