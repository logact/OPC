import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createDbClient } from '@opc/database';
import { OpcHttpClient } from '@logact-pub/opc-sdk';
import { createServer } from '../src/server.js';
import {
  createAuthenticatedHttpClient,
  startTestServer,
} from './helpers.js';

type JsonObject = Record<string, unknown>;

function organizationSdk(http: OpcHttpClient): OpcHttpClient {
  return http;
}

function asObject(value: unknown, label = 'value'): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function objectField(value: JsonObject, key: string): JsonObject {
  return asObject(value[key], key);
}

function arrayField(value: JsonObject, key: string): unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new Error(`${key} must be an array`);
  return field;
}

function stringField(value: JsonObject, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') throw new Error(`${key} must be a string`);
  return field;
}

function findById(values: unknown[], id: string): JsonObject | undefined {
  return values
    .map((value) => asObject(value))
    .find((value) => value.id === id);
}

function findDepartmentNode(values: unknown[], id: string): JsonObject | undefined {
  for (const value of values) {
    const node = asObject(value, 'department node');
    if (node.id === id) return node;
    const children = node.children;
    if (Array.isArray(children)) {
      const match = findDepartmentNode(children, id);
      if (match) return match;
    }
  }
  return undefined;
}

async function expectSdkError(
  action: () => Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ status, code }));
    return;
  }
  throw new Error(`expected SDK error ${status} ${code}`);
}

const TEST_JWT_SECRET = 'organization-e2e-secret-must-have-at-least-32-characters';

interface MigrationJournal {
  entries: Array<{
    idx: number;
    when: number;
    tag: string;
  }>;
}

interface StaffProfileRow {
  participant_id: string;
  is_owner: boolean;
}

interface CountRow {
  count: number;
}

function databaseUrlWithSchema(baseUrl: string, schemaName: string): string {
  if (!/^opc_org_e2e_[a-f0-9]+$/.test(schemaName)) {
    throw new Error(`unsafe temporary schema name: ${schemaName}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

async function withTemporarySchema<T>(
  action: (db: ReturnType<typeof createDbClient>, schemaName: string) => Promise<T>
): Promise<T> {
  const baseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc';
  const schemaName = `opc_org_e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const databaseUrl = databaseUrlWithSchema(baseUrl, schemaName);
  const admin = createDbClient(baseUrl);
  let created = false;

  try {
    await admin.$client.query(`CREATE SCHEMA "${schemaName}"`);
    created = true;
    const db = createDbClient(databaseUrl);
    try {
      return await action(db, schemaName);
    } finally {
      await db.$client.end();
    }
  } finally {
    if (created) {
      await admin.$client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    }
    await admin.$client.end();
  }
}

async function applyMigrationRange(
  db: ReturnType<typeof createDbClient>,
  schemaName: string,
  include: (index: number) => boolean
): Promise<number> {
  const migrationsDirectory = new URL('../../../packages/database/src/migrations/', import.meta.url);
  const journal = JSON.parse(
    await readFile(new URL('meta/_journal.json', migrationsDirectory), 'utf8')
  ) as MigrationJournal;
  const entries = journal.entries
    .filter((entry) => include(entry.idx))
    .sort((left, right) => left.idx - right.idx);

  for (const entry of entries) {
    const source = await readFile(new URL(`${entry.tag}.sql`, migrationsDirectory), 'utf8');
    const migration = source.replaceAll('"public".', `"${schemaName}".`);
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await db.$client.query(statement);
    }
  }
  return entries.length;
}

async function applyLegacyMigrations(
  db: ReturnType<typeof createDbClient>,
  schemaName: string
): Promise<void> {
  const applied = await applyMigrationRange(db, schemaName, (index) => index <= 6);
  if (applied !== 7) throw new Error(`expected migrations 0000-0006, found ${applied}`);
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve).once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP server address');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('Organization contract and persistence (issue #14)', () => {
  it('round-trips the singleton and a deterministically ordered deep department tree', async () => {
    const { cleanup } = await startTestServer();

    try {
      const sdk = organizationSdk(await createAuthenticatedHttpClient());
      const suffix = randomUUID();

      const initial = objectField(asObject(await sdk.getOrganization()), 'organization');
      const organizationId = stringField(initial, 'id');
      expect(stringField(initial, 'name').length).toBeGreaterThan(0);

      const renamed = objectField(
        asObject(await sdk.updateOrganization({ name: `OPC E2E ${suffix}` })),
        'organization'
      );
      expect(renamed).toMatchObject({ id: organizationId, name: `OPC E2E ${suffix}` });

      const root = objectField(
        asObject(await sdk.createDepartment({ name: `Root ${suffix}`, parentId: null })),
        'department'
      );
      const rootId = stringField(root, 'id');
      const childB = objectField(
        asObject(await sdk.createDepartment({ name: `B child ${suffix}`, parentId: rootId })),
        'department'
      );
      const childA = objectField(
        asObject(await sdk.createDepartment({ name: `A child ${suffix}`, parentId: rootId })),
        'department'
      );
      const childAId = stringField(childA, 'id');
      const grandchild = objectField(
        asObject(
          await sdk.createDepartment({
            name: `Grandchild ${suffix}`,
            parentId: childAId,
          })
        ),
        'department'
      );

      const tree = asObject(await sdk.getOrganizationTree());
      expect(objectField(tree, 'organization')).toMatchObject({
        id: organizationId,
        name: `OPC E2E ${suffix}`,
      });
      const rootNode = findDepartmentNode(arrayField(tree, 'departments'), rootId);
      expect(rootNode).toBeDefined();
      const children = arrayField(rootNode!, 'children');
      expect(children.map((value) => stringField(asObject(value), 'id'))).toEqual([
        childAId,
        stringField(childB, 'id'),
      ]);
      expect(findDepartmentNode(children, stringField(grandchild, 'id'))).toMatchObject({
        parentId: childAId,
      });
    } finally {
      await cleanup();
    }
  });

  it('rejects orphan and cyclic department moves without partially mutating the tree', async () => {
    const { cleanup } = await startTestServer();

    try {
      const sdk = organizationSdk(await createAuthenticatedHttpClient());
      const suffix = randomUUID();
      const root = objectField(
        asObject(await sdk.createDepartment({ name: `Cycle root ${suffix}`, parentId: null })),
        'department'
      );
      const rootId = stringField(root, 'id');
      const child = objectField(
        asObject(await sdk.createDepartment({ name: `Cycle child ${suffix}`, parentId: rootId })),
        'department'
      );
      const childId = stringField(child, 'id');
      const grandchild = objectField(
        asObject(
          await sdk.createDepartment({ name: `Cycle leaf ${suffix}`, parentId: childId })
        ),
        'department'
      );
      const grandchildId = stringField(grandchild, 'id');

      await expectSdkError(
        () => sdk.createDepartment({ name: `Orphan ${suffix}`, parentId: `missing-${suffix}` }),
        422,
        'invalid_department_parent'
      );
      await expectSdkError(
        () => sdk.updateDepartment(childId, { parentId: `missing-${suffix}` }),
        422,
        'invalid_department_parent'
      );
      await expectSdkError(
        () => sdk.updateDepartment(rootId, { parentId: grandchildId }),
        409,
        'department_cycle'
      );
      await expectSdkError(
        () => sdk.updateDepartment(rootId, { parentId: rootId }),
        409,
        'department_cycle'
      );

      expect(objectField(asObject(await sdk.getDepartment(rootId)), 'department')).toMatchObject({
        id: rootId,
        parentId: null,
      });
      expect(objectField(asObject(await sdk.getDepartment(childId)), 'department')).toMatchObject({
        id: childId,
        parentId: rootId,
      });
    } finally {
      await cleanup();
    }
  });

  it('enforces department and position dependency-safe deletes', async () => {
    const { cleanup } = await startTestServer();

    try {
      const sdk = organizationSdk(await createAuthenticatedHttpClient());
      const suffix = randomUUID();
      const root = objectField(
        asObject(await sdk.createDepartment({ name: `Delete root ${suffix}`, parentId: null })),
        'department'
      );
      const rootId = stringField(root, 'id');
      const child = objectField(
        asObject(await sdk.createDepartment({ name: `Delete child ${suffix}`, parentId: rootId })),
        'department'
      );
      const childId = stringField(child, 'id');

      await expectSdkError(
        () => sdk.deleteDepartment(rootId),
        409,
        'department_has_dependents'
      );

      const position = objectField(
        asObject(
          await sdk.createPosition({
            departmentId: childId,
            name: `Dependent position ${suffix}`,
            responsibilities: [],
            skillTags: [],
            capabilityGrants: [],
          })
        ),
        'position'
      );

      await expectSdkError(
        () => sdk.deleteDepartment(childId),
        409,
        'department_has_dependents'
      );

      await sdk.deletePosition(stringField(position, 'id'));
      await sdk.deleteDepartment(childId);
      await expectSdkError(
        () => sdk.getDepartment(childId),
        404,
        'department_not_found'
      );
      await sdk.deleteDepartment(rootId);
    } finally {
      await cleanup();
    }
  });

  it('round-trips and moves position responsibilities, skills, and scoped grants', async () => {
    const { cleanup } = await startTestServer();

    try {
      const sdk = organizationSdk(await createAuthenticatedHttpClient());
      const suffix = randomUUID();
      const source = objectField(
        asObject(await sdk.createDepartment({ name: `Source ${suffix}`, parentId: null })),
        'department'
      );
      const target = objectField(
        asObject(await sdk.createDepartment({ name: `Target ${suffix}`, parentId: null })),
        'department'
      );
      const sourceId = stringField(source, 'id');
      const targetId = stringField(target, 'id');
      const responsibilities = [
        { id: `deploy-${suffix}`, title: 'Ship releases', description: 'Own releases' },
        { id: `operate-${suffix}`, title: 'Operate OPC', description: 'Keep OPC healthy' },
      ];
      const capabilityGrants = [
        { capability: 'participant.read', scope: { type: 'department' } },
        { capability: 'room.manage', scope: { type: 'department_subtree' } },
      ];

      const created = objectField(
        asObject(
          await sdk.createPosition({
            departmentId: sourceId,
            name: `Platform engineer ${suffix}`,
            description: 'Builds and operates OPC',
            responsibilities,
            skillTags: ['mqtt', 'typescript'],
            capabilityGrants,
          })
        ),
        'position'
      );
      const positionId = stringField(created, 'id');
      expect(created).toMatchObject({
        departmentId: sourceId,
        responsibilities,
        skillTags: ['mqtt', 'typescript'],
        capabilityGrants,
      });

      const moved = objectField(
        asObject(
          await sdk.updatePosition(positionId, {
            departmentId: targetId,
            name: `Principal platform engineer ${suffix}`,
          })
        ),
        'position'
      );
      expect(moved).toMatchObject({
        id: positionId,
        departmentId: targetId,
        name: `Principal platform engineer ${suffix}`,
        responsibilities,
        skillTags: ['mqtt', 'typescript'],
        capabilityGrants,
      });

      const sourcePositions = arrayField(
        asObject(await sdk.listPositions({ departmentId: sourceId })),
        'positions'
      );
      const targetPositions = arrayField(
        asObject(await sdk.listPositions({ departmentId: targetId })),
        'positions'
      );
      expect(findById(sourcePositions, positionId)).toBeUndefined();
      expect(findById(targetPositions, positionId)).toMatchObject({ departmentId: targetId });
    } finally {
      await cleanup();
    }
  });

  it('auto-creates staff for humans and agents, excludes gateways, and retains one Owner', async () => {
    const { cleanup } = await startTestServer();

    try {
      const authenticatedHttp = await createAuthenticatedHttpClient();
      const sdk = organizationSdk(authenticatedHttp);
      const suffix = randomUUID();
      const humanId = `org-human-${suffix}`;
      const gatewayId = `org-gateway-${suffix}`;
      const agentId = `org-agent-${suffix}`;

      await authenticatedHttp.registerParticipant(humanId, `Human ${suffix}`);
      await authenticatedHttp.registerParticipant(gatewayId, `Gateway ${suffix}`, undefined, 'gateway');
      await authenticatedHttp.registerParticipant(
        agentId,
        `Agent ${suffix}`,
        undefined,
        'agent',
        gatewayId
      );

      const staff = arrayField(asObject(await sdk.listStaff()), 'staff').map((value) =>
        asObject(value, 'staff profile')
      );
      expect(staff.some((profile) => profile.participantId === humanId)).toBe(true);
      expect(staff.some((profile) => profile.participantId === agentId)).toBe(true);
      expect(staff.some((profile) => profile.participantId === gatewayId)).toBe(false);
      expect(staff.filter((profile) => profile.isOwner === true)).toHaveLength(1);

      expect(objectField(asObject(await sdk.getStaff(humanId)), 'staff')).toMatchObject({
        participantId: humanId,
        assignments: [],
      });
      expect(objectField(asObject(await sdk.getStaff(agentId)), 'staff')).toMatchObject({
        participantId: agentId,
        assignments: [],
      });
      await expectSdkError(
        () => sdk.getStaff(gatewayId),
        422,
        'participant_not_staff'
      );
    } finally {
      await cleanup();
    }
  });

  it('supports multiple active positions and leaders while rejecting invalid assignments', async () => {
    const { cleanup } = await startTestServer();

    try {
      const authenticatedHttp = await createAuthenticatedHttpClient();
      const sdk = organizationSdk(authenticatedHttp);
      const suffix = randomUUID();
      const leaderA = `leader-a-${suffix}`;
      const leaderB = `leader-b-${suffix}`;
      const gatewayId = `assignment-gateway-${suffix}`;
      await authenticatedHttp.registerParticipant(leaderA);
      await authenticatedHttp.registerParticipant(leaderB);
      await authenticatedHttp.registerParticipant(gatewayId, undefined, undefined, 'gateway');

      const department = objectField(
        asObject(await sdk.createDepartment({ name: `Leadership ${suffix}`, parentId: null })),
        'department'
      );
      const departmentId = stringField(department, 'id');
      const positionA = objectField(
        asObject(
          await sdk.createPosition({
            departmentId,
            name: `Lead ${suffix}`,
            responsibilities: [],
            skillTags: [],
            capabilityGrants: [],
          })
        ),
        'position'
      );
      const positionB = objectField(
        asObject(
          await sdk.createPosition({
            departmentId,
            name: `Engineer ${suffix}`,
            responsibilities: [],
            skillTags: [],
            capabilityGrants: [],
          })
        ),
        'position'
      );
      const positionAId = stringField(positionA, 'id');
      const positionBId = stringField(positionB, 'id');

      const assignmentA = objectField(
        asObject(
          await sdk.createStaffAssignment(leaderA, {
            positionId: positionAId,
            active: true,
            isDepartmentLeader: true,
          })
        ),
        'assignment'
      );
      await sdk.createStaffAssignment(leaderA, {
        positionId: positionBId,
        active: true,
        isDepartmentLeader: false,
      });
      await sdk.createStaffAssignment(leaderB, {
        positionId: positionAId,
        active: true,
        isDepartmentLeader: true,
      });

      await expectSdkError(
        () =>
          sdk.createStaffAssignment(leaderA, {
            positionId: positionAId,
            active: true,
            isDepartmentLeader: false,
          }),
        409,
        'duplicate_assignment'
      );
      await expectSdkError(
        () =>
          sdk.createStaffAssignment(leaderB, {
            positionId: positionBId,
            active: false,
            isDepartmentLeader: true,
          }),
        422,
        'invalid_department_leader'
      );
      await expectSdkError(
        () =>
          sdk.createStaffAssignment(gatewayId, {
            positionId: positionBId,
            active: true,
            isDepartmentLeader: false,
          }),
        422,
        'participant_not_staff'
      );
      await expectSdkError(
        () => sdk.updateStaffAssignment(stringField(assignmentA, 'id'), { active: false }),
        422,
        'invalid_department_leader'
      );
      await expectSdkError(
        () => sdk.deletePosition(positionAId),
        409,
        'position_has_assignments'
      );

      const tree = asObject(await sdk.getOrganizationTree());
      const node = findDepartmentNode(arrayField(tree, 'departments'), departmentId);
      expect(node).toBeDefined();
      const leaderIds = arrayField(node!, 'leaders')
        .map((value) => stringField(asObject(value, 'leader summary'), 'participantId'))
        .sort();
      expect(leaderIds).toEqual([leaderA, leaderB].sort());
    } finally {
      await cleanup();
    }
  });

  it('returns deterministic active-assignment responsibility, skill, and capability unions', async () => {
    const { cleanup } = await startTestServer();

    try {
      const authenticatedHttp = await createAuthenticatedHttpClient();
      const sdk = organizationSdk(authenticatedHttp);
      const suffix = randomUUID();
      const staffId = `effective-staff-${suffix}`;
      await authenticatedHttp.registerParticipant(staffId);

      const departmentA = objectField(
        asObject(await sdk.createDepartment({ name: `Effective A ${suffix}`, parentId: null })),
        'department'
      );
      const departmentB = objectField(
        asObject(await sdk.createDepartment({ name: `Effective B ${suffix}`, parentId: null })),
        'department'
      );
      const sharedResponsibility = {
        id: `responsibility-b-${suffix}`,
        title: 'Operate',
        description: 'Operate shared systems',
      };
      const sharedGrant = { capability: 'room.read', scope: { type: 'department' } };

      const positionA = objectField(
        asObject(
          await sdk.createPosition({
            departmentId: stringField(departmentA, 'id'),
            name: `Position A ${suffix}`,
            responsibilities: [
              sharedResponsibility,
              {
                id: `responsibility-a-${suffix}`,
                title: 'Build',
                description: 'Build OPC',
              },
            ],
            skillTags: ['typescript', 'mqtt'],
            capabilityGrants: [
              sharedGrant,
              { capability: 'room.manage', scope: { type: 'department_subtree' } },
            ],
          })
        ),
        'position'
      );
      const positionB = objectField(
        asObject(
          await sdk.createPosition({
            departmentId: stringField(departmentB, 'id'),
            name: `Position B ${suffix}`,
            responsibilities: [
              {
                id: `responsibility-c-${suffix}`,
                title: 'Review',
                description: 'Review releases',
              },
              sharedResponsibility,
            ],
            skillTags: ['postgres', 'mqtt'],
            capabilityGrants: [
              { capability: 'participant.read', scope: { type: 'organization' } },
              sharedGrant,
            ],
          })
        ),
        'position'
      );

      const assignmentA = objectField(
        asObject(
          await sdk.createStaffAssignment(staffId, {
            positionId: stringField(positionA, 'id'),
            active: true,
            isDepartmentLeader: false,
          })
        ),
        'assignment'
      );
      await sdk.createStaffAssignment(staffId, {
        positionId: stringField(positionB, 'id'),
        active: true,
        isDepartmentLeader: false,
      });

      const effective = objectField(asObject(await sdk.getStaff(staffId)), 'staff');
      expect(
        arrayField(effective, 'effectiveResponsibilities').map((value) =>
          stringField(asObject(value, 'responsibility'), 'id')
        )
      ).toEqual([
        `responsibility-a-${suffix}`,
        `responsibility-b-${suffix}`,
        `responsibility-c-${suffix}`,
      ]);
      expect(arrayField(effective, 'effectiveSkillTags')).toEqual([
        'mqtt',
        'postgres',
        'typescript',
      ]);
      expect(arrayField(effective, 'effectiveCapabilityGrants')).toEqual([
        { capability: 'participant.read', scope: { type: 'organization' } },
        { capability: 'room.manage', scope: { type: 'department_subtree' } },
        sharedGrant,
      ]);

      await sdk.updateStaffAssignment(stringField(assignmentA, 'id'), {
        active: false,
        isDepartmentLeader: false,
      });
      const afterDeactivation = objectField(asObject(await sdk.getStaff(staffId)), 'staff');
      expect(
        arrayField(afterDeactivation, 'effectiveResponsibilities').map((value) =>
          stringField(asObject(value, 'responsibility'), 'id')
        )
      ).toEqual([`responsibility-b-${suffix}`, `responsibility-c-${suffix}`]);
      expect(arrayField(afterDeactivation, 'effectiveSkillTags')).toEqual(['mqtt', 'postgres']);
      expect(arrayField(afterDeactivation, 'effectiveCapabilityGrants')).toEqual([
        { capability: 'participant.read', scope: { type: 'organization' } },
        sharedGrant,
      ]);
    } finally {
      await cleanup();
    }
  });

  it('keeps the Owner human and rejects attempts to turn it into infrastructure identity', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = await createAuthenticatedHttpClient();
      const sdk = organizationSdk(http);
      const staff = arrayField(asObject(await sdk.listStaff()), 'staff').map((value) =>
        asObject(value, 'staff profile')
      );
      const owner = staff.find((profile) => profile.isOwner === true);
      expect(owner).toBeDefined();
      const ownerId = stringField(owner!, 'participantId');

      await expectSdkError(
        () => http.updateParticipant(ownerId, { kind: 'gateway' }),
        409,
        'owner_immutable'
      );
      await expectSdkError(
        () => http.updateParticipant(ownerId, { kind: 'agent' }),
        409,
        'owner_immutable'
      );
      expect(objectField(asObject(await sdk.getStaff(ownerId)), 'staff')).toMatchObject({
        participantId: ownerId,
        isOwner: true,
      });
    } finally {
      await cleanup();
    }
  });

  it('migrates existing staff deterministically and excludes gateways', async () => {
    await withTemporarySchema(async (db, schemaName) => {
      await applyLegacyMigrations(db, schemaName);
      await db.$client.query(`
        INSERT INTO participants (id, kind, name, created_at) VALUES
          ('migration-gateway', 'gateway', 'Gateway', '2019-01-01T00:00:00.000Z'),
          ('migration-human-z', 'human', 'Human Z', '2020-01-01T00:00:00.000Z'),
          ('migration-human-a', 'human', 'Human A', '2020-01-01T00:00:00.000Z'),
          ('migration-agent', 'agent', 'Agent', '2021-01-01T00:00:00.000Z'),
          ('migration-human-later', 'human', 'Human Later', '2022-01-01T00:00:00.000Z')
      `);

      const organizationMigrations = await applyMigrationRange(
        db,
        schemaName,
        (index) => index > 6
      );
      expect(organizationMigrations).toBeGreaterThan(0);

      const organizations = await db.$client.query<CountRow>(
        'SELECT COUNT(*)::int AS count FROM organizations'
      );
      expect(organizations.rows).toEqual([{ count: 1 }]);

      const profiles = await db.$client.query<StaffProfileRow>(`
        SELECT participant_id, is_owner
        FROM staff_profiles
        ORDER BY participant_id ASC
      `);
      expect(profiles.rows).toEqual([
        { participant_id: 'migration-agent', is_owner: false },
        { participant_id: 'migration-human-a', is_owner: true },
        { participant_id: 'migration-human-later', is_owner: false },
        { participant_id: 'migration-human-z', is_owner: false },
      ]);

    });
  }, 30_000);

  it('bootstraps an empty database and makes its first human the Owner through the SDK', async () => {
    await withTemporarySchema(async (db, schemaName) => {
      await applyMigrationRange(db, schemaName, () => true);
      const server = createServer({
        db,
        jwtSecret: TEST_JWT_SECRET,
        mqttSuperuser: { username: '__server__', password: 'e2e-superuser-secret' },
      });

      try {
        const baseUrl = await listen(server);
        const http = new OpcHttpClient(baseUrl);
        const sdk = organizationSdk(http);
        const suffix = randomUUID();
        const firstHumanId = `fresh-human-a-${suffix}`;
        const secondHumanId = `fresh-human-b-${suffix}`;
        const gatewayId = `fresh-gateway-${suffix}`;
        const agentId = `fresh-agent-${suffix}`;

        const { token } = await http.registerParticipant(firstHumanId);
        http.setAccessToken(token);
        await http.registerParticipant(secondHumanId);
        await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
        await http.registerParticipant(agentId, undefined, undefined, 'agent', gatewayId);

        expect(objectField(asObject(await sdk.getStaff(firstHumanId)), 'staff')).toMatchObject({
          participantId: firstHumanId,
          isOwner: true,
        });
        expect(objectField(asObject(await sdk.getStaff(secondHumanId)), 'staff')).toMatchObject({
          participantId: secondHumanId,
          isOwner: false,
        });
        expect(objectField(asObject(await sdk.getStaff(agentId)), 'staff')).toMatchObject({
          participantId: agentId,
          isOwner: false,
        });
        await expectSdkError(
          () => sdk.getStaff(gatewayId),
          422,
          'participant_not_staff'
        );

        const staff = arrayField(asObject(await sdk.listStaff()), 'staff').map((value) =>
          asObject(value, 'staff profile')
        );
        expect(staff.filter((profile) => profile.isOwner === true)).toHaveLength(1);
      } finally {
        await closeServer(server);
      }
    });
  }, 30_000);
});
