import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { Participant as CoreParticipant } from '@logact-pub/opc-protocol';
import type { DbClient } from '../client/index.js';
import { participants } from '../schema/index.js';

export interface ParticipantUpdatePatch {
  name?: string;
  kind?: CoreParticipant['kind'];
  metadata?: Record<string, unknown>;
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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

    async list(): Promise<CoreParticipant[]> {
      const rows = await db.select().from(participants).orderBy(asc(participants.createdAt));
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        metadata: row.metadata ?? undefined,
      }));
    },

    async update(
      id: string,
      patch: ParticipantUpdatePatch
    ): Promise<CoreParticipant | undefined> {
      const [row] = await db
        .update(participants)
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.kind !== undefined && { kind: patch.kind }),
          ...(patch.metadata !== undefined && { metadata: patch.metadata }),
        })
        .where(eq(participants.id, id))
        .returning();

      if (!row) return undefined;

      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        metadata: row.metadata ?? undefined,
      };
    },

    /**
     * 注册参与者并发放 MQTT 登录 token。
     * 已存在时轮换 token（旧 token 立即失效）；明文 token 仅此一次返回。
     */
    async register(
      id: string,
      name?: string,
      kind: CoreParticipant['kind'] = 'human'
    ): Promise<{ participant: CoreParticipant; token: string }> {
      const token = generateToken();
      const tokenHash = hashToken(token);

      const [row] = await db
        .insert(participants)
        .values({ id, kind, name: name ?? id, tokenHash })
        .onConflictDoUpdate({
          target: participants.id,
          set: { tokenHash, name: name ?? id },
        })
        .returning();

      return {
        participant: {
          id: row.id,
          kind: row.kind,
          name: row.name,
          metadata: row.metadata ?? undefined,
        },
        token,
      };
    },

    /** 校验 MQTT CONNECT 凭据（username=id, password=token） */
    async verifyToken(id: string, token: string): Promise<boolean> {
      const row = await db.query.participants.findFirst({
        where: eq(participants.id, id),
        columns: { tokenHash: true },
      });
      if (!row?.tokenHash) return false;
      const expected = Buffer.from(row.tokenHash, 'hex');
      const actual = Buffer.from(hashToken(token), 'hex');
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
  };
}

export type ParticipantRepository = ReturnType<typeof createParticipantRepository>;
