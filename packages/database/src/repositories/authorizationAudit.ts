import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type {
  AuthorizationAuditEntry,
  ListAuthorizationAuditQuery,
} from '@logact-pub/opc-protocol';
import type { DbClient } from '../client/index.js';
import {
  authorizationAudit,
  type AuthorizationAuditRow,
  type NewAuthorizationAuditRow,
} from '../schema/index.js';

function toEntry(row: AuthorizationAuditRow): AuthorizationAuditEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    ...(row.claimedActorId ? { claimedActorId: row.claimedActorId } : {}),
    channel: row.channel,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ...(row.departmentId !== null ? { departmentId: row.departmentId } : {}),
    outcome: row.outcome,
    reason: row.reason,
    timestamp: row.createdAt.toISOString(),
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}

export function createAuthorizationAuditRepository(db: DbClient) {
  return {
    async append(input: Omit<NewAuthorizationAuditRow, 'id' | 'createdAt'>): Promise<void> {
      await db.insert(authorizationAudit).values(input);
    },

    async list(query: ListAuthorizationAuditQuery): Promise<{
      entries: AuthorizationAuditEntry[];
      nextCursor?: string;
    }> {
      const conditions: SQL[] = [];
      if (query.actorId) conditions.push(eq(authorizationAudit.actorId, query.actorId));
      if (query.outcome) conditions.push(eq(authorizationAudit.outcome, query.outcome));
      if (query.cursor) {
        const cursor = await db.query.authorizationAudit.findFirst({
          where: eq(authorizationAudit.id, query.cursor),
        });
        if (cursor) conditions.push(lt(authorizationAudit.createdAt, cursor.createdAt));
      }
      const rows = await db
        .select()
        .from(authorizationAudit)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(authorizationAudit.createdAt), desc(authorizationAudit.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      return {
        entries: page.map(toEntry),
        ...(hasMore && page.length > 0 ? { nextCursor: page[page.length - 1].id } : {}),
      };
    },
  };
}

export type AuthorizationAuditRepository = ReturnType<typeof createAuthorizationAuditRepository>;
