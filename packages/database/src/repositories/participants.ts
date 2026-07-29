import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
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

const SCRYPT_KEYLEN = 64;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) return reject(err);
      resolve(key);
    });
  });
  return `${salt}:${derived.toString('hex')}`;
}

async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) return reject(err);
      resolve(key);
    });
  });
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function createParticipantRepository(db: DbClient) {
  type ParticipantRow = typeof participants.$inferSelect;

  /** DB 行 → 核心模型；lastSeen 为空表示从未上线，不带 presence 字段 */
  function toCore(row: ParticipantRow): CoreParticipant {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      metadata: row.metadata ?? undefined,
      presence: row.lastSeen
        ? { online: row.online, lastSeen: row.lastSeen.toISOString() }
        : undefined,
    };
  }

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
        return toCore(existing);
      }

      const [created] = await db
        .insert(participants)
        .values({ id, kind, name: name ?? id })
        .returning();

      return toCore(created);
    },

    async findById(id: string): Promise<CoreParticipant | undefined> {
      const row = await db.query.participants.findFirst({
        where: eq(participants.id, id),
      });
      if (!row) return undefined;
      return toCore(row);
    },

    async list(): Promise<CoreParticipant[]> {
      const rows = await db.select().from(participants).orderBy(asc(participants.createdAt));
      return rows.map(toCore);
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

      return toCore(row);
    },

    /**
     * 更新在线状态。lastSeen 由 server 打时间戳：presence 负载不携带时间
     * （LWT 在 CONNECT 时注册，其内嵌时间必是连接时间而非断线时间）。
     */
    async setPresence(id: string, online: boolean): Promise<void> {
      await db
        .update(participants)
        .set({ online, lastSeen: new Date() })
        .where(eq(participants.id, id));
    },

    /**
     * 注册参与者并发放 MQTT 登录 token。
     * 已存在时轮换 token（旧 token 立即失效）；明文 token 仅此一次返回。
     * kind 纠正语义（issue #69）：已落库为 human 的行允许被显式 kind 升级为
     * gateway/agent；非 human 的 kind 保持粘性，缺省 kind 的重复注册不会降级。
     */
    async register(
      id: string,
      name?: string,
      kind: CoreParticipant['kind'] = 'human',
      password?: string
    ): Promise<{ participant: CoreParticipant; token: string }> {
      const token = generateToken();
      const tokenHash = hashToken(token);
      const passwordHash = password ? await hashPassword(password) : undefined;

      const [row] = await db
        .insert(participants)
        .values({
          id,
          kind,
          name: name ?? id,
          tokenHash,
          ...(passwordHash ? { passwordHash } : {}),
        })
        .onConflictDoUpdate({
          target: participants.id,
          set: {
            tokenHash,
            name: name ?? id,
            kind: sql`case when ${participants.kind} = 'human' then excluded.kind else ${participants.kind} end`,
            ...(passwordHash ? { passwordHash } : {}),
          },
        })
        .returning();

      return {
        participant: toCore(row),
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

    /** 按 register 发放的 token 查找参与者（HTTP Bearer 鉴权，与 MQTT 同一凭据） */
    async findByToken(token: string): Promise<CoreParticipant | undefined> {
      const hashedToken = hashToken(token);
      const [row] = await db
        .select()
        .from(participants)
        .where(eq(participants.tokenHash, hashedToken))
        .limit(1);
      if (!row) return undefined;
      return toCore(row);
    },

    /** 校验 HTTP 登录密码（username=id, password=明文密码） */
    async verifyPassword(id: string, password: string): Promise<boolean> {
      const row = await db.query.participants.findFirst({
        where: eq(participants.id, id),
        columns: { passwordHash: true },
      });
      if (!row?.passwordHash) return false;
      return verifyPasswordHash(password, row.passwordHash);
    },

    /** 设置/重置登录密码 */
    async setPassword(
      id: string,
      password: string
    ): Promise<CoreParticipant | undefined> {
      const passwordHash = await hashPassword(password);
      const [row] = await db
        .update(participants)
        .set({ passwordHash })
        .where(eq(participants.id, id))
        .returning();

      if (!row) return undefined;

      return toCore(row);
    },
  };
}

export type ParticipantRepository = ReturnType<typeof createParticipantRepository>;
