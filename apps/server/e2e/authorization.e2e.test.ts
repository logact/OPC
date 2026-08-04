import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@opc/database';
import type { AgentMessage, IAgent, ThreadInfo, ThreadOptions } from '@opc/agent-edge';
import { AgentGateway } from '@opc/agent-gateway';
import mqtt, { type IClientOptions } from 'mqtt';
import { OpcClient, OpcHttpClient } from '@logact-pub/opc-sdk';
import { API_ROUTES, MQTT_ACL, MQTT_TOPICS } from '@logact-pub/opc-protocol';
import {
  DEFAULT_PASSWORD,
  TEST_BASE_URL,
  TEST_MQTT,
  connectSdkClient,
  createAuthenticatedHttpClient,
  getOwnerId,
  getOwnerToken,
  startTestServer,
  waitForEvent,
  type TestServer,
} from './helpers.js';

type JsonObject = Record<string, unknown>;
type ParticipantKind = 'human' | 'agent' | 'gateway';
type ScopeType = 'self' | 'department' | 'department_subtree' | 'organization';

interface CapabilityGrantInput {
  capability: string;
  scope: { type: ScopeType };
}

interface FutureAuthorizationSdk {
  registerParticipant(
    id: string,
    name?: string,
    password?: string,
    kind?: ParticipantKind,
    gatewayId?: string
  ): Promise<unknown>;
  login(participantId: string, password: string): Promise<unknown>;
  getOrganization(): Promise<unknown>;
  updateOrganization(request: { name: string }): Promise<unknown>;
  createDepartment(request: { name: string; parentId?: string | null }): Promise<unknown>;
  updateDepartment(
    departmentId: string,
    request: { name?: string; parentId?: string | null }
  ): Promise<unknown>;
  createPosition(request: {
    departmentId: string;
    name: string;
    responsibilities?: unknown[];
    skillTags?: string[];
    capabilityGrants?: CapabilityGrantInput[];
  }): Promise<unknown>;
  createStaffAssignment(
    participantId: string,
    request: { positionId: string; active?: boolean; isDepartmentLeader?: boolean }
  ): Promise<unknown>;
  updateStaffAssignment(
    assignmentId: string,
    request: { active?: boolean; isDepartmentLeader?: boolean }
  ): Promise<unknown>;
  getStaff(participantId: string): Promise<unknown>;
  getParticipant(participantId: string): Promise<unknown>;
  updateParticipant(participantId: string, request: { name?: string }): Promise<unknown>;
  createRoom(request: {
    name: string;
    participantIds?: string[];
    departmentId?: string;
  }): Promise<unknown>;
  createDirectRoom(request: { participantIds: [string, string] }): Promise<unknown>;
  getRoom(roomId: string): Promise<unknown>;
  listRooms(): Promise<unknown>;
  updateRoom(
    roomId: string,
    request: { name?: string; departmentId?: string | null }
  ): Promise<unknown>;
  addRoomMembers(roomId: string, request: { participantIds: string[] }): Promise<unknown>;
  removeRoomMember(roomId: string, participantId: string): Promise<unknown>;
  broadcastMessage(
    roomId: string,
    request: { content: { type: 'text'; body: string } }
  ): Promise<unknown>;
  getHistory(roomId: string): Promise<unknown>;
  getMessage(messageId: string): Promise<unknown>;
  listAuthorizationAudit(query?: {
    actorId?: string;
    outcome?: 'allowed' | 'denied';
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
}

interface RegisteredIdentity {
  id: string;
  token: string;
  http: FutureAuthorizationSdk;
}

function authorizationSdk(http: OpcHttpClient): FutureAuthorizationSdk {
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

async function expectSdkError(
  action: () => Promise<unknown>,
  status: number,
  code: 'unauthorized' | 'forbidden'
): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ status, code }));
    return;
  }
  throw new Error(`expected SDK error ${status} ${code}`);
}

function databaseUrlWithSchema(baseUrl: string, schemaName: string): string {
  if (!/^opc_authz_e2e_[a-f0-9]+$/.test(schemaName)) {
    throw new Error(`unsafe temporary schema name: ${schemaName}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

/* eslint-disable @typescript-eslint/require-await */
class ReplyAgent extends EventEmitter implements IAgent {
  readonly agentId: string;
  private messageHandler?: (message: AgentMessage) => void;
  private lastGoal = '';
  private threadSequence = 0;

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
  }

  async initialize(): Promise<void> {}
  async start(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async terminate(): Promise<void> {}
  async destroy(): Promise<void> {}
  async receiveMessage(): Promise<void> {}
  async pauseThread(): Promise<void> {}
  async completeThread(): Promise<void> {}
  async resumeThread(): Promise<void> {}
  async terminateThread(): Promise<void> {}
  async destroyThread(): Promise<void> {}

  async getInfo() {
    return {
      agentId: this.agentId,
      status: 'running' as const,
      activity: 'idle' as const,
      threadIds: [],
    };
  }

  async createThread(options: ThreadOptions): Promise<string> {
    this.lastGoal = options.goal;
    this.threadSequence += 1;
    return `${this.agentId}-thread-${this.threadSequence}`;
  }

  async getThread(): Promise<ThreadInfo> {
    return { threadId: 'thread', status: 'running', goal: this.lastGoal };
  }

  async getThreads(): Promise<ThreadInfo[]> {
    return [];
  }

  async getMessages(): Promise<AgentMessage[]> {
    return [];
  }

  async startThread(threadId: string): Promise<void> {
    this.messageHandler?.({
      id: `reply-${threadId}`,
      timestamp: Date.now(),
      from: this.agentId,
      threadId,
      content: { type: 'text', body: `Authorized reply: ${this.lastGoal}` },
    });
  }

  onMessage(handler: (message: AgentMessage) => void): () => void {
    this.messageHandler = handler;
    return () => {
      this.messageHandler = undefined;
    };
  }

  onStatusChange(): () => void {
    return () => undefined;
  }
}
/* eslint-enable @typescript-eslint/require-await */

function waitForMessageFrom(client: OpcClient, participantId: string): Promise<JsonObject> {
  return new Promise((resolve) => {
    const handler = (event: unknown) => {
      const message = objectField(asObject(event), 'message');
      if (message.from !== participantId) return;
      client.events.off('message.delivered', handler);
      resolve(message);
    };
    client.events.on('message.delivered', handler);
  });
}

function createRecordingConnect(publishedTopics: string[]): typeof mqtt.connect {
  const connect = (
    brokerUrlOrOptions: string | IClientOptions,
    options?: IClientOptions
  ) => {
    const client =
      typeof brokerUrlOrOptions === 'string'
        ? mqtt.connect(brokerUrlOrOptions, options)
        : mqtt.connect(brokerUrlOrOptions);
    client.on('packetsend', (packet) => {
      if (packet.cmd === 'publish') publishedTopics.push(packet.topic);
    });
    return client;
  };
  return connect;
}

describe('Organization-scoped authorization (issue #112)', () => {
  const baseDatabaseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc';
  const schemaName = `opc_authz_e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const scopedDatabaseUrl = databaseUrlWithSchema(baseDatabaseUrl, schemaName);
  const admin = createDbClient(baseDatabaseUrl);
  let server: TestServer;
  let publicHttp: FutureAuthorizationSdk;
  let owner: FutureAuthorizationSdk;
  let ownerId: string;
  let ownerToken: string;

  beforeAll(async () => {
    await admin.$client.query(`CREATE SCHEMA "${schemaName}"`);
    server = await startTestServer(scopedDatabaseUrl, {
      migrationsSchema: schemaName,
    });
    publicHttp = authorizationSdk(new OpcHttpClient(server.baseUrl));
    owner = authorizationSdk(await createAuthenticatedHttpClient());
    ownerId = getOwnerId();
    ownerToken = getOwnerToken();
  }, 30_000);

  afterAll(async () => {
    await server?.cleanup();
    await admin.$client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await admin.$client.end();
  }, 30_000);

  async function registerIdentity(
    prefix: string,
    kind: ParticipantKind = 'human',
    gatewayId?: string
  ): Promise<RegisteredIdentity> {
    const id = `${prefix}-${randomUUID()}`;
    const password = kind === 'gateway' ? undefined : DEFAULT_PASSWORD;
    const registration = asObject(
      await owner.registerParticipant(id, id, password, kind, gatewayId)
    );
    const token = stringField(registration, 'token');
    if (kind === 'gateway') {
      return {
        id,
        token,
        http: authorizationSdk(new OpcHttpClient(server.baseUrl, token)),
      };
    }
    const login = asObject(await publicHttp.login(id, DEFAULT_PASSWORD));
    return {
      id,
      token,
      http: authorizationSdk(
        new OpcHttpClient(server.baseUrl, stringField(login, 'accessToken'))
      ),
    };
  }

  async function createDepartment(name: string, parentId: string | null = null): Promise<string> {
    const response = asObject(await owner.createDepartment({ name, parentId }));
    return stringField(objectField(response, 'department'), 'id');
  }

  async function createPosition(
    departmentId: string,
    grants: CapabilityGrantInput[] = [],
    name = `Position ${randomUUID()}`
  ): Promise<string> {
    const response = asObject(
      await owner.createPosition({
        departmentId,
        name,
        responsibilities: [],
        skillTags: [],
        capabilityGrants: grants,
      })
    );
    return stringField(objectField(response, 'position'), 'id');
  }

  async function assign(
    participantId: string,
    positionId: string,
    isDepartmentLeader = false
  ): Promise<string> {
    const response = asObject(
      await owner.createStaffAssignment(participantId, {
        positionId,
        isDepartmentLeader,
      })
    );
    return stringField(objectField(response, 'assignment'), 'id');
  }

  async function placeInDepartment(participantId: string, departmentId: string): Promise<void> {
    await assign(participantId, await createPosition(departmentId));
  }

  it('resolves JWT and participant tokens to one actor and distinguishes 401 from 403', async () => {
    await expectSdkError(() => publicHttp.getOrganization(), 401, 'unauthorized');
    await expectSdkError(
      () => authorizationSdk(new OpcHttpClient(server.baseUrl, 'invalid-token')).getOrganization(),
      401,
      'unauthorized'
    );

    const ordinary = await registerIdentity('authz-ordinary');
    await expectSdkError(() => ordinary.http.getOrganization(), 403, 'forbidden');

    expect(objectField(asObject(await owner.getOrganization()), 'organization')).toBeDefined();
    const ownerByParticipantToken = authorizationSdk(
      new OpcHttpClient(server.baseUrl, ownerToken)
    );
    expect(
      objectField(asObject(await ownerByParticipantToken.getOrganization()), 'organization')
    ).toBeDefined();

    await expectSdkError(
      () => publicHttp.registerParticipant(`post-bootstrap-${randomUUID()}`),
      401,
      'unauthorized'
    );
  });

  it('unions active positions without expanding department scopes and revokes immediately', async () => {
    const rootA = await createDepartment(`Union A ${randomUUID()}`);
    const childA = await createDepartment(`Union A child ${randomUUID()}`, rootA);
    const rootB = await createDepartment(`Union B ${randomUUID()}`);
    const actor = await registerIdentity('authz-union-actor');
    const targetA = await registerIdentity('authz-union-target-a');
    const targetChild = await registerIdentity('authz-union-target-child');
    const targetB = await registerIdentity('authz-union-target-b');
    await placeInDepartment(targetA.id, rootA);
    await placeInDepartment(targetChild.id, childA);
    await placeInDepartment(targetB.id, rootB);

    const readDepartment = await createPosition(rootA, [
      { capability: 'participant.read', scope: { type: 'department' } },
    ]);
    const createInB = await createPosition(rootB, [
      { capability: 'room.create', scope: { type: 'department' } },
    ]);
    await assign(actor.id, readDepartment);
    const roomAssignment = await assign(actor.id, createInB);

    expect(objectField(asObject(await actor.http.getParticipant(targetA.id)), 'participant')).toBeDefined();
    await expectSdkError(() => actor.http.getParticipant(targetChild.id), 403, 'forbidden');
    await expectSdkError(() => actor.http.getParticipant(targetB.id), 403, 'forbidden');
    await expectSdkError(
      () => actor.http.createRoom({ name: 'wrong scope', departmentId: rootA }),
      403,
      'forbidden'
    );
    expect(
      stringField(
        asObject(await actor.http.createRoom({ name: 'right scope', departmentId: rootB })),
        'roomId'
      )
    ).toBeTruthy();

    await assign(
      actor.id,
      await createPosition(rootA, [
        { capability: 'participant.read', scope: { type: 'department_subtree' } },
      ])
    );
    expect(
      objectField(asObject(await actor.http.getParticipant(targetChild.id)), 'participant')
    ).toBeDefined();

    await owner.updateStaffAssignment(roomAssignment, { active: false });
    await expectSdkError(
      () => actor.http.createRoom({ name: 'revoked', departmentId: rootB }),
      403,
      'forbidden'
    );
  });

  it('gives leaders management only inside their subtree and never implicit message access', async () => {
    const rootA = await createDepartment(`Leader A ${randomUUID()}`);
    const rootB = await createDepartment(`Leader B ${randomUUID()}`);
    const leader = await registerIdentity('authz-leader');
    const inScope = await registerIdentity('authz-leader-target');
    const outOfScope = await registerIdentity('authz-leader-outsider');
    await assign(leader.id, await createPosition(rootA), true);
    await placeInDepartment(inScope.id, rootA);
    await placeInDepartment(outOfScope.id, rootB);

    const child = objectField(
      asObject(
        await leader.http.createDepartment({
          name: `Leader-created child ${randomUUID()}`,
          parentId: rootA,
        })
      ),
      'department'
    );
    const childId = stringField(child, 'id');
    expect(
      objectField(
        asObject(
          await leader.http.createPosition({
            departmentId: childId,
            name: `Leader-created position ${randomUUID()}`,
            capabilityGrants: [],
          })
        ),
        'position'
      )
    ).toBeDefined();
    expect(
      objectField(
        asObject(await leader.http.updateParticipant(inScope.id, { name: 'In-scope renamed' })),
        'participant'
      )
    ).toMatchObject({ name: 'In-scope renamed' });

    await expectSdkError(
      () => leader.http.updateParticipant(outOfScope.id, { name: 'Forbidden rename' }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () => leader.http.updateDepartment(rootB, { name: 'Forbidden department' }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () => leader.http.updateOrganization({ name: 'Forbidden organization' }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () =>
        leader.http.createPosition({
          departmentId: childId,
          name: 'Escalating position',
          capabilityGrants: [
            { capability: 'organization.manage', scope: { type: 'organization' } },
          ],
        }),
      403,
      'forbidden'
    );
  });

  it('prevents capability and assignment delegation beyond the actor ceiling', async () => {
    const root = await createDepartment(`Delegation root ${randomUUID()}`);
    const child = await createDepartment(`Delegation child ${randomUUID()}`, root);
    const delegator = await registerIdentity('authz-delegator');
    await assign(
      delegator.id,
      await createPosition(root, [
        { capability: 'position.manage', scope: { type: 'department_subtree' } },
        { capability: 'staff.manage', scope: { type: 'department_subtree' } },
        { capability: 'participant.read', scope: { type: 'department_subtree' } },
        { capability: 'capability.delegate', scope: { type: 'department_subtree' } },
      ])
    );

    expect(
      objectField(
        asObject(
          await delegator.http.createPosition({
            departmentId: child,
            name: `Bounded delegated role ${randomUUID()}`,
            capabilityGrants: [
              { capability: 'participant.read', scope: { type: 'department' } },
            ],
          })
        ),
        'position'
      )
    ).toBeDefined();

    await expectSdkError(
      () =>
        delegator.http.createPosition({
          departmentId: child,
          name: 'Too-wide delegated role',
          capabilityGrants: [
            { capability: 'participant.read', scope: { type: 'organization' } },
          ],
        }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () =>
        delegator.http.createPosition({
          departmentId: child,
          name: 'Unknown-authority delegated role',
          capabilityGrants: [{ capability: 'message.read', scope: { type: 'department' } }],
        }),
      403,
      'forbidden'
    );

    const organizationAdmin = await createPosition(root, [
      { capability: 'organization.manage', scope: { type: 'organization' } },
    ]);
    await expectSdkError(
      () => delegator.http.createStaffAssignment(delegator.id, { positionId: organizationAdmin }),
      403,
      'forbidden'
    );
  });

  it('scopes participant and agent lifecycle management while preserving owned-gateway delegation', async () => {
    const rootA = await createDepartment(`Agent lifecycle A ${randomUUID()}`);
    const rootB = await createDepartment(`Agent lifecycle B ${randomUUID()}`);
    const manager = await registerIdentity('authz-agent-manager');
    const ordinary = await registerIdentity('authz-agent-ordinary');
    const gatewayA = await registerIdentity('authz-agent-gateway-a', 'gateway');
    const gatewayB = await registerIdentity('authz-agent-gateway-b', 'gateway');
    const agentA = await registerIdentity('authz-managed-agent-a', 'agent', gatewayA.id);
    const agentB = await registerIdentity('authz-managed-agent-b', 'agent', gatewayB.id);
    await assign(
      manager.id,
      await createPosition(rootA, [
        { capability: 'participant.read', scope: { type: 'department_subtree' } },
        { capability: 'participant.manage', scope: { type: 'department_subtree' } },
        { capability: 'agent.manage', scope: { type: 'department_subtree' } },
      ])
    );
    await placeInDepartment(agentA.id, rootA);
    await placeInDepartment(agentB.id, rootB);

    expect(
      objectField(
        asObject(await manager.http.updateParticipant(agentA.id, { name: 'Managed in A' })),
        'participant'
      )
    ).toMatchObject({ name: 'Managed in A' });
    await expectSdkError(
      () => manager.http.updateParticipant(agentB.id, { name: 'Forbidden in B' }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () =>
        ordinary.http.registerParticipant(
          `ordinary-agent-${randomUUID()}`,
          undefined,
          DEFAULT_PASSWORD,
          'agent',
          gatewayA.id
        ),
      403,
      'forbidden'
    );

    expect(
      stringField(
        asObject(
          await gatewayA.http.registerParticipant(
            `owned-agent-${randomUUID()}`,
            undefined,
            DEFAULT_PASSWORD,
            'agent',
            gatewayA.id
          )
        ),
        'participantId'
      )
    ).toBeTruthy();
    await expectSdkError(
      () =>
        gatewayA.http.registerParticipant(
          `foreign-agent-${randomUUID()}`,
          undefined,
          DEFAULT_PASSWORD,
          'agent',
          gatewayB.id
        ),
      403,
      'forbidden'
    );
  });

  it('keeps direct rooms private and membership immutable even for Owner', async () => {
    const department = await createDepartment(`Direct privacy ${randomUUID()}`);
    const alice = await registerIdentity('authz-direct-alice');
    const bob = await registerIdentity('authz-direct-bob');
    const eve = await registerIdentity('authz-direct-eve');
    const directRole = await createPosition(department, [
      { capability: 'room.create', scope: { type: 'self' } },
      { capability: 'room.read', scope: { type: 'self' } },
      { capability: 'message.read', scope: { type: 'self' } },
      { capability: 'message.send', scope: { type: 'self' } },
    ]);
    await assign(alice.id, directRole);
    await assign(bob.id, directRole);
    await assign(eve.id, directRole);

    const roomId = stringField(
      asObject(
        await alice.http.createDirectRoom({ participantIds: [alice.id, bob.id] })
      ),
      'roomId'
    );
    expect(objectField(asObject(await alice.http.getRoom(roomId)), 'room')).toMatchObject({
      creatorId: alice.id,
      type: 'direct',
      departmentId: null,
    });
    expect(objectField(asObject(await bob.http.getRoom(roomId)), 'room')).toBeDefined();

    await expectSdkError(() => owner.getRoom(roomId), 403, 'forbidden');
    expect(
      arrayField(asObject(await owner.listRooms()), 'rooms').some(
        (room) => asObject(room).id === roomId
      )
    ).toBe(false);
    await expectSdkError(
      () => eve.http.createDirectRoom({ participantIds: [alice.id, bob.id] }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () => owner.addRoomMembers(roomId, { participantIds: [eve.id] }),
      403,
      'forbidden'
    );

    const sent = objectField(
      asObject(
        await alice.http.broadcastMessage(roomId, {
          content: { type: 'text', body: 'private hello' },
        })
      ),
      'message'
    );
    expect(sent).toMatchObject({ from: alice.id, roomId });
    await expectSdkError(
      () =>
        alice.http.broadcastMessage(roomId, {
          from: bob.id,
          content: { type: 'text', body: 'forged sender' },
        }),
      403,
      'forbidden'
    );
    expect(
      arrayField(
        asObject(
          await owner.listAuthorizationAudit({
            actorId: alice.id,
            outcome: 'denied',
            limit: 50,
          })
        ),
        'entries'
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: alice.id,
          claimedActorId: bob.id,
          action: 'message.send',
          resourceType: 'room',
          resourceId: roomId,
          outcome: 'denied',
        }),
      ])
    );
    expect(arrayField(asObject(await bob.http.getHistory(roomId)), 'messages')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: sent.id, from: alice.id })])
    );
    await expectSdkError(
      () => owner.getMessage(stringField(sent, 'id')),
      403,
      'forbidden'
    );
  });

  it('enforces group creator/department scope on membership and ownership changes', async () => {
    const rootA = await createDepartment(`Group A ${randomUUID()}`);
    const childA = await createDepartment(`Group A child ${randomUUID()}`, rootA);
    const rootB = await createDepartment(`Group B ${randomUUID()}`);
    const creator = await registerIdentity('authz-group-creator');
    const leader = await registerIdentity('authz-group-leader');
    const inScope = await registerIdentity('authz-group-member');
    const outsider = await registerIdentity('authz-group-outsider');
    await assign(
      creator.id,
      await createPosition(rootA, [
        { capability: 'room.create', scope: { type: 'department_subtree' } },
        { capability: 'room.read', scope: { type: 'self' } },
      ])
    );
    await assign(leader.id, await createPosition(rootA), true);
    await placeInDepartment(inScope.id, childA);
    await placeInDepartment(outsider.id, rootB);

    const roomId = stringField(
      asObject(
        await creator.http.createRoom({
          name: `Department room ${randomUUID()}`,
          participantIds: [creator.id],
          departmentId: childA,
        })
      ),
      'roomId'
    );
    expect(objectField(asObject(await creator.http.getRoom(roomId)), 'room')).toMatchObject({
      creatorId: creator.id,
      type: 'group',
      departmentId: childA,
    });

    const roomWithMember = objectField(
      asObject(await leader.http.addRoomMembers(roomId, { participantIds: [inScope.id] })),
      'room'
    );
    expect(arrayField(roomWithMember, 'participantIds')).toContain(inScope.id);
    await expectSdkError(
      () => leader.http.addRoomMembers(roomId, { participantIds: [outsider.id] }),
      403,
      'forbidden'
    );
    expect(await leader.http.removeRoomMember(roomId, inScope.id)).toBeDefined();
    await expectSdkError(
      () => leader.http.updateRoom(roomId, { departmentId: rootB }),
      403,
      'forbidden'
    );
    expect(
      arrayField(asObject(await outsider.http.listRooms()), 'rooms').some(
        (room) => asObject(room).id === roomId
      )
    ).toBe(false);
  });

  it('makes HTTP history/send and MQTT subscribe/send reach the same decision', async () => {
    const department = await createDepartment(`Parity ${randomUUID()}`);
    const allowed = await registerIdentity('authz-parity-allowed');
    const denied = await registerIdentity('authz-parity-denied');
    await assign(
      allowed.id,
      await createPosition(department, [
        { capability: 'room.create', scope: { type: 'department' } },
        { capability: 'room.read', scope: { type: 'self' } },
        { capability: 'message.read', scope: { type: 'self' } },
        { capability: 'message.send', scope: { type: 'self' } },
      ])
    );
    await placeInDepartment(denied.id, department);
    const roomId = stringField(
      asObject(
        await allowed.http.createRoom({
          name: `Parity room ${randomUUID()}`,
          participantIds: [allowed.id, denied.id],
          departmentId: department,
        })
      ),
      'roomId'
    );

    expect(await allowed.http.getHistory(roomId)).toBeDefined();
    await expectSdkError(() => denied.http.getHistory(roomId), 403, 'forbidden');
    await expectSdkError(
      () =>
        denied.http.broadcastMessage(roomId, {
          content: { type: 'text', body: 'forbidden over HTTP' },
        }),
      403,
      'forbidden'
    );

    // The broker calls this endpoint for SUBSCRIBE/PUBLISH. Assert the actual
    // callback contract directly as well, because local development brokers
    // are sometimes launched without the go-auth plugin while CI uses it.
    const mqttAcl = async (username: string, topic: string, acc: number) =>
      fetch(`${server.baseUrl}${API_ROUTES.auth.mqttAcl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, topic, acc }),
      });
    expect(
      (await mqttAcl(allowed.id, MQTT_TOPICS.events(roomId), MQTT_ACL.SUBSCRIBE)).status
    ).toBe(200);
    expect(
      (await mqttAcl(denied.id, MQTT_TOPICS.events(roomId), MQTT_ACL.SUBSCRIBE)).status
    ).toBe(403);
    expect(
      (
        await mqttAcl(
          denied.id,
          MQTT_TOPICS.participantUplink(denied.id, roomId),
          MQTT_ACL.WRITE
        )
      ).status
    ).toBe(403);

    let allowedMqtt: OpcClient | undefined;
    let deniedMqtt: OpcClient | undefined;
    try {
      allowedMqtt = await connectSdkClient(allowed.id, allowed.token);
      deniedMqtt = await connectSdkClient(denied.id, denied.token);
      await allowedMqtt.subscribeRoom(roomId);
      await deniedMqtt.subscribeRoom(roomId).catch(() => undefined);

      const delivered = waitForEvent(allowedMqtt, 'message.delivered');
      await allowedMqtt.sendText(roomId, 'authorized over MQTT');
      expect((await delivered).message).toMatchObject({
        roomId,
        from: allowed.id,
        content: { body: 'authorized over MQTT' },
      });
    } finally {
      await deniedMqtt?.disconnect();
      await allowedMqtt?.disconnect();
    }
  }, 40_000);

  it('binds a gateway reply to its owned, authorized agent on the uplink topic', async () => {
    const department = await createDepartment(`Gateway authz ${randomUUID()}`);
    const gateway = await registerIdentity('authz-gateway', 'gateway');
    const human = await registerIdentity('authz-gateway-human');
    await assign(
      human.id,
      await createPosition(department, [
        { capability: 'room.create', scope: { type: 'department' } },
        { capability: 'room.read', scope: { type: 'self' } },
        { capability: 'message.read', scope: { type: 'self' } },
        { capability: 'message.send', scope: { type: 'self' } },
      ])
    );

    let edgeGateway: AgentGateway | undefined;
    let humanMqtt: OpcClient | undefined;
    const gatewayPublishedTopics: string[] = [];
    try {
      let spawnedResolve: (participantId: string) => void = () => undefined;
      const spawned = new Promise<string>((resolve) => {
        spawnedResolve = resolve;
      });
      edgeGateway = new AgentGateway({
        gatewayId: gateway.id,
        serverUrl: TEST_BASE_URL,
        brokerUrl: TEST_MQTT.brokerUrl,
        token: gateway.token,
        connectFn: createRecordingConnect(gatewayPublishedTopics),
        agentFactory: (participantId) => {
          spawnedResolve(participantId);
          return new ReplyAgent(participantId);
        },
      });
      await edgeGateway.start();

      const agent = await registerIdentity('authz-gateway-agent', 'agent', gateway.id);
      await assign(
        agent.id,
        await createPosition(department, [
          { capability: 'room.read', scope: { type: 'self' } },
          { capability: 'message.read', scope: { type: 'self' } },
          { capability: 'message.send', scope: { type: 'self' } },
        ])
      );
      expect(await spawned).toBe(agent.id);

      const roomId = stringField(
        asObject(
          await human.http.createRoom({
            name: `Gateway room ${randomUUID()}`,
            participantIds: [human.id, agent.id],
            departmentId: department,
          })
        ),
        'roomId'
      );
      humanMqtt = await connectSdkClient(human.id, human.token);
      await humanMqtt.subscribeRoom(roomId);
      const reply = waitForMessageFrom(humanMqtt, agent.id);
      await humanMqtt.sendText(roomId, 'hello authorized agent');
      expect(stringField(objectField(await reply, 'content'), 'body')).toContain(
        'hello authorized agent'
      );
      expect(gatewayPublishedTopics).toContain(
        `opc/participants/${agent.id}/rooms/${roomId}/uplink`
      );
    } finally {
      await humanMqtt?.disconnect();
      await edgeGateway?.stop();
    }
  }, 40_000);

  it('records sensitive allows and valid-identity denials in a queryable audit trail', async () => {
    const rootA = await createDepartment(`Audit A ${randomUUID()}`);
    const rootB = await createDepartment(`Audit B ${randomUUID()}`);
    const leader = await registerIdentity('authz-audit-leader');
    const outsider = await registerIdentity('authz-audit-outsider');
    await assign(leader.id, await createPosition(rootA), true);
    await placeInDepartment(outsider.id, rootB);

    await expectSdkError(() => leader.http.getParticipant(outsider.id), 403, 'forbidden');
    const created = objectField(
      asObject(
        await owner.createDepartment({
          name: `Audited mutation ${randomUUID()}`,
          parentId: rootA,
        })
      ),
      'department'
    );

    const denied = arrayField(
      asObject(
        await owner.listAuthorizationAudit({
          actorId: leader.id,
          outcome: 'denied',
          limit: 50,
        })
      ),
      'entries'
    );
    expect(denied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: leader.id,
          channel: 'http',
          action: 'participant.read',
          outcome: 'denied',
          resourceType: 'participant',
          resourceId: outsider.id,
        }),
      ])
    );

    const allowed = arrayField(
      asObject(
        await owner.listAuthorizationAudit({ actorId: ownerId, outcome: 'allowed', limit: 50 })
      ),
      'entries'
    );
    expect(allowed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: ownerId,
          channel: 'http',
          action: 'department.manage',
          outcome: 'allowed',
          resourceType: 'department',
          resourceId: stringField(created, 'id'),
        }),
      ])
    );

    await expectSdkError(
      () => leader.http.listAuthorizationAudit({ actorId: leader.id }),
      403,
      'forbidden'
    );
  });

  it('publishes task authorization grants for downstream #109 without inventing task routes', async () => {
    const root = await createDepartment(`Task policy root ${randomUUID()}`);
    const child = await createDepartment(`Task policy child ${randomUUID()}`, root);
    const actor = await registerIdentity('authz-task-policy');
    await assign(
      actor.id,
      await createPosition(root, [
        { capability: 'task.read', scope: { type: 'department_subtree' } },
        { capability: 'task.assign', scope: { type: 'department' } },
      ])
    );
    await assign(
      actor.id,
      await createPosition(child, [
        { capability: 'task.review', scope: { type: 'self' } },
      ])
    );

    const staff = objectField(asObject(await owner.getStaff(actor.id)), 'staff');
    expect(arrayField(staff, 'effectiveCapabilityGrants')).toEqual(
      expect.arrayContaining([
        { capability: 'task.read', scope: { type: 'department_subtree' } },
        { capability: 'task.assign', scope: { type: 'department' } },
        { capability: 'task.review', scope: { type: 'self' } },
      ])
    );
  });
});
