import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@opc/database';
import { OpcClient, OpcHttpClient } from '@logact-pub/opc-sdk';
import {
  DEFAULT_PASSWORD,
  connectSdkClient,
  createAuthenticatedHttpClient,
  getOwnerAccessToken,
  getOwnerId,
  getOwnerToken,
  startTestServer,
  type TestServer,
} from './helpers.js';

type JsonObject = Record<string, unknown>;
type ParticipantKind = 'human' | 'agent' | 'gateway';
// issue #130：去掉 review 状态；submit 直接进入 completed。
type TaskStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * issue #130 之后 SDK task 方法的目标签名（TDD：实现尚未落地）。
 * 与旧签名的差异：createTask 不再有 departmentId/target/requiredSkillTags，
 * 新增可选 assigneeId（创建即指派）；assignTask 不再有 reviewerId/collaboratorIds；
 * recommendTask/approveTask/rejectTask 被移除；updateTask 只剩 title/description。
 */
interface FutureTaskSdk {
  registerParticipant(
    id: string,
    name?: string,
    password?: string,
    kind?: ParticipantKind,
    gatewayId?: string
  ): Promise<unknown>;
  login(participantId: string, password: string): Promise<unknown>;
  createTask(request: {
    title: string;
    description?: string;
    assigneeId?: string;
    parentTaskId?: string;
    originRoomId?: string;
  }): Promise<unknown>;
  decomposeTask(
    taskId: string,
    request: {
      subtasks: Array<{ title: string; description?: string; assigneeId?: string }>;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  listTasks(query?: {
    status?: TaskStatus;
    creatorId?: string;
    assigneeId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  getTask(taskId: string): Promise<unknown>;
  updateTask(
    taskId: string,
    request: {
      title?: string;
      description?: string;
    }
  ): Promise<unknown>;
  assignTask(
    taskId: string,
    request: {
      assigneeId: string;
      reason?: string;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  startTask(
    taskId: string,
    request: { idempotencyKey: string; assignmentId?: string }
  ): Promise<unknown>;
  blockTask(
    taskId: string,
    request: { reason: string; idempotencyKey: string; assignmentId?: string }
  ): Promise<unknown>;
  resumeTask(
    taskId: string,
    request: { reason: string; idempotencyKey: string; assignmentId?: string }
  ): Promise<unknown>;
  submitTask(
    taskId: string,
    request: {
      summary: string;
      metadata?: Record<string, unknown>;
      idempotencyKey: string;
      assignmentId?: string;
    }
  ): Promise<unknown>;
  failTask(
    taskId: string,
    request: {
      reason: string;
      diagnostics?: string;
      idempotencyKey: string;
      assignmentId?: string;
    }
  ): Promise<unknown>;
  cancelTask(
    taskId: string,
    request: { reason: string; idempotencyKey: string }
  ): Promise<unknown>;
  appendTaskEvent(
    taskId: string,
    request: {
      kind: 'progress' | 'note' | 'decision' | 'artifact';
      message: string;
      metadata?: Record<string, unknown>;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  getRoom(roomId: string): Promise<unknown>;
  getHistory(roomId: string): Promise<unknown>;
  createRoom(request: { name: string; participantIds?: string[] }): Promise<unknown>;
}

interface RegisteredIdentity {
  id: string;
  token: string;
  http: FutureTaskSdk;
}

function taskSdk(http: OpcHttpClient): FutureTaskSdk {
  return http;
}

type FutureOpcHttpClientConstructor = new (
  baseUrl: string,
  accessToken?: string,
  options?: { actorId: string }
) => OpcHttpClient;

function delegatedTaskSdk(baseUrl: string, gatewayToken: string, agentId: string): FutureTaskSdk {
  const DelegatedOpcHttpClient = OpcHttpClient as unknown as FutureOpcHttpClientConstructor;
  return taskSdk(new DelegatedOpcHttpClient(baseUrl, gatewayToken, { actorId: agentId }));
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

function nullableStringField(value: JsonObject, key: string): string | null {
  const field = value[key];
  if (field === null) return null;
  if (typeof field !== 'string') throw new Error(`${key} must be a string or null`);
  return field;
}

function taskFrom(response: unknown): JsonObject {
  return objectField(asObject(response), 'task');
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

/**
 * 只断言 HTTP 状态码、不断言 error code：
 * human-only 指派等场景的具体 code 由实现者决定（issue #130 可能重命名
 * human_confirmation_required），测试只锁定 403 这一契约。
 */
async function expectSdkStatus(action: () => Promise<unknown>, status: number): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ status }));
    return;
  }
  throw new Error(`expected SDK error ${status}`);
}

function databaseUrlWithSchema(baseUrl: string, schemaName: string): string {
  if (!/^opc_tasks_e2e_[a-f0-9]+$/.test(schemaName)) {
    throw new Error(`unsafe temporary schema name: ${schemaName}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

function waitForTaskEvent(
  client: OpcClient,
  predicate: (event: JsonObject) => boolean
): Promise<JsonObject> {
  return new Promise((resolve) => {
    const handler = (value: unknown) => {
      const event = asObject(value, 'task event');
      if (!predicate(event)) return;
      client.events.off('task.event', handler);
      resolve(event);
    };
    client.events.on('task.event', handler);
  });
}

describe('First-class task domain (issue #130)', () => {
  const baseDatabaseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc';
  const schemaName = `opc_tasks_e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const scopedDatabaseUrl = databaseUrlWithSchema(baseDatabaseUrl, schemaName);
  const admin = createDbClient(baseDatabaseUrl);
  let server: TestServer;
  let publicHttp: FutureTaskSdk;
  let owner: FutureTaskSdk;
  let ownerId: string;
  let ownerToken: string;
  let ownerAccessToken: string;
  let gateway: RegisteredIdentity;

  beforeAll(async () => {
    await admin.$client.query(`CREATE SCHEMA "${schemaName}"`);
    server = await startTestServer(scopedDatabaseUrl, {
      migrationsSchema: schemaName,
    });
    publicHttp = taskSdk(new OpcHttpClient(server.baseUrl));
    owner = taskSdk(await createAuthenticatedHttpClient());
    ownerId = getOwnerId();
    ownerToken = getOwnerToken();
    ownerAccessToken = getOwnerAccessToken();
    gateway = await registerIdentity('task-gateway', 'gateway');
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
      return { id, token, http: taskSdk(new OpcHttpClient(server.baseUrl, token)) };
    }
    const login = asObject(await publicHttp.login(id, DEFAULT_PASSWORD));
    return {
      id,
      token,
      http: taskSdk(new OpcHttpClient(server.baseUrl, stringField(login, 'accessToken'))),
    };
  }

  async function createDraft(
    options: { title?: string; description?: string } = {},
    actor: FutureTaskSdk = owner
  ): Promise<JsonObject> {
    return taskFrom(
      await actor.createTask({
        title: options.title ?? `Task ${randomUUID()}`,
        description: options.description ?? 'Acceptance task description',
      })
    );
  }

  async function createAssigned(
    assigneeId: string,
    options: { title?: string; description?: string } = {},
    actor: FutureTaskSdk = owner
  ): Promise<JsonObject> {
    return taskFrom(
      await actor.createTask({
        title: options.title ?? `Task ${randomUUID()}`,
        description: options.description ?? 'Acceptance task description',
        assigneeId,
      })
    );
  }

  async function assignDraft(
    taskId: string,
    assigneeId: string,
    key = `assign-${randomUUID()}`,
    actor: FutureTaskSdk = owner
  ): Promise<JsonObject> {
    return taskFrom(await actor.assignTask(taskId, { assigneeId, idempotencyKey: key }));
  }

  /** issue #130 移除的路由不再出现在 API_ROUTES 中，410 shim 测试直接硬编码路径 */
  async function rawApi(path: string, body?: unknown): Promise<Response> {
    return fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAccessToken}`,
      },
      body: JSON.stringify(body ?? {}),
    });
  }

  it('creates a draft task without department, target, reviewer, or collaborator fields', async () => {
    const draft = await createDraft({ title: `Draft ${randomUUID()}` });

    expect(draft).toMatchObject({
      status: 'draft',
      creatorId: ownerId,
      assigneeId: null,
      roomId: null,
    });
    for (const removed of [
      'departmentId',
      'target',
      'requiredSkillTags',
      'reviewerId',
      'collaboratorIds',
    ]) {
      expect(draft).not.toHaveProperty(removed);
    }
  });

  it('creates and directly assigns a task to a human in one step', async () => {
    const assignee = await registerIdentity('task-create-assignee');
    const task = await createAssigned(assignee.id, { title: 'One-step assignment' });
    const taskId = stringField(task, 'id');

    expect(task).toMatchObject({
      status: 'assigned',
      creatorId: ownerId,
      assigneeId: assignee.id,
    });
    const roomId = nullableStringField(task, 'roomId');
    expect(roomId).toBeTruthy();
    expect(stringField(task, 'assignedAt')).toBeTruthy();

    const room = objectField(asObject(await owner.getRoom(roomId!)), 'room');
    expect(arrayField(room, 'participantIds')).toEqual(
      expect.arrayContaining([ownerId, assignee.id])
    );

    const detail = asObject(await owner.getTask(taskId));
    const assignments = arrayField(detail, 'assignments');
    expect(assignments).toHaveLength(1);
    expect(asObject(assignments[0])).toMatchObject({ assigneeId: assignee.id });
  });

  it('assigns a task directly to an agent with no staff position and dispatches once', async () => {
    const agent = await registerIdentity('task-create-agent', 'agent', gateway.id);
    const task = await createAssigned(agent.id, { title: 'Fire-and-forget agent task' });
    const taskId = stringField(task, 'id');
    expect(task).toMatchObject({ status: 'assigned', assigneeId: agent.id });
    const roomId = nullableStringField(task, 'roomId');
    if (!roomId) throw new Error('direct assignment must create a task room');

    const detail = asObject(await owner.getTask(taskId));
    const assignmentId = stringField(asObject(arrayField(detail, 'assignments')[0]), 'id');
    const history = asObject(await owner.getHistory(roomId));
    const dispatches = arrayField(history, 'messages')
      .map((message) => asObject(message))
      .filter((message) => message.intent === 'task');

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      roomId,
      from: ownerId,
      intent: 'task',
      metadata: {
        opcTask: {
          kind: 'assignment',
          taskId,
          assignmentId,
          assigneeId: agent.id,
        },
      },
    });
    expect(stringField(objectField(dispatches[0], 'content'), 'body')).toContain(
      'Fire-and-forget agent task'
    );
  });

  it('posts a task card message to the origin room on create-with-assignee (issue #129)', async () => {
    const agent = await registerIdentity('task-card-agent', 'agent', gateway.id);
    const dm = asObject(
      await owner.createRoom({ name: `dm-${randomUUID()}`, participantIds: [agent.id] })
    );
    const dmRoomId = stringField(dm, 'roomId');

    const task = taskFrom(
      await owner.createTask({
        title: 'Chat-created task',
        description: 'Created from the chat page in task mode',
        assigneeId: agent.id,
        originRoomId: dmRoomId,
      })
    );
    const taskId = stringField(task, 'id');
    expect(task).toMatchObject({ status: 'assigned', assigneeId: agent.id });

    // 任务卡片回到发起房间：metadata.opcTask.kind = 'reference'，正文含标题
    const history = asObject(await owner.getHistory(dmRoomId));
    const cards = arrayField(history, 'messages')
      .map((message) => asObject(message))
      .filter(
        (message) =>
          asObject(message.metadata ?? {}, 'metadata').opcTask !== undefined
      );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      roomId: dmRoomId,
      from: ownerId,
      metadata: { opcTask: { kind: 'reference', taskId } },
    });
    expect(stringField(objectField(cards[0], 'content'), 'body')).toContain(
      'Chat-created task'
    );
  });

  it('validates originRoomId usage on create (issue #129)', async () => {
    const outsider = await registerIdentity('task-card-outsider');
    const agent = await registerIdentity('task-card-member-agent', 'agent', gateway.id);
    const otherAgent = await registerIdentity('task-card-stranger-agent', 'agent', gateway.id);
    // owner 创建的房间 owner 自动成为成员（server 端 union creatorId）
    const dm = asObject(
      await owner.createRoom({ name: `dm-${randomUUID()}`, participantIds: [agent.id] })
    );
    const dmRoomId = stringField(dm, 'roomId');

    // originRoomId 必须搭配 assigneeId（创建即指派）
    await expectSdkStatus(
      () => owner.createTask({ title: 'draft with origin', originRoomId: dmRoomId }),
      422
    );
    // creator 不是 origin 房间成员 → 403（outsider 不在该房间）
    await expectSdkStatus(
      () =>
        outsider.http.createTask({
          title: 'intrude',
          assigneeId: agent.id,
          originRoomId: dmRoomId,
        }),
      403
    );
    // assignee 不是 origin 房间成员 → 422
    await expectSdkStatus(
      () =>
        owner.createTask({
          title: 'assignee not in origin room',
          assigneeId: otherAgent.id,
          originRoomId: dmRoomId,
        }),
      422
    );
  });

  it('allows any participant to create a draft but requires a human actor for assignment at creation', async () => {
    const assignee = await registerIdentity('task-human-only-assignee');
    const agent = await registerIdentity('task-human-only-agent', 'agent', gateway.id);
    const agentActor = delegatedTaskSdk(server.baseUrl, gateway.token, agent.id);

    // agent / gateway 可以创建 draft 任务
    const agentDraft = await createDraft({}, agentActor);
    expect(agentDraft).toMatchObject({ status: 'draft', creatorId: agent.id });
    const gatewayDraft = await createDraft({}, gateway.http);
    expect(gatewayDraft).toMatchObject({ status: 'draft', creatorId: gateway.id });

    // 但创建即指派属于 assignment，只能由 human 发起（不断言具体 error code）
    await expectSdkStatus(() => createAssigned(assignee.id, {}, agentActor), 403);
    await expectSdkStatus(() => createAssigned(assignee.id, {}, gateway.http), 403);
  });

  it('lets the current assignee, including a delegated agent, decompose work into independently assigned subtasks', async () => {
    const delegatedAgent = await registerIdentity('task-decompose-agent', 'agent', gateway.id);
    const childAssignee = await registerIdentity('task-decompose-child');
    const parent = await createAssigned(delegatedAgent.id, { title: 'Agent parent task' });
    const parentId = stringField(parent, 'id');
    const agent = delegatedTaskSdk(server.baseUrl, gateway.token, delegatedAgent.id);

    const response = asObject(
      await agent.decomposeTask(parentId, {
        subtasks: [
          {
            title: 'Delegated child task',
            description: 'The agent split this without a human confirmation step',
            assigneeId: childAssignee.id,
          },
        ],
        idempotencyKey: `agent-decompose-${randomUUID()}`,
      })
    );
    const child = asObject(arrayField(response, 'children')[0]);
    expect(child).toMatchObject({
      parentTaskId: parentId,
      creatorId: delegatedAgent.id,
      assigneeId: childAssignee.id,
      status: 'assigned',
    });
    expect(nullableStringField(child, 'roomId')).toBeTruthy();

    const detail = asObject(await owner.getTask(parentId));
    expect(arrayField(detail, 'children')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: child.id, parentTaskId: parentId })])
    );
    expect(arrayField(detail, 'events')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'task.decomposed', actorId: delegatedAgent.id }),
      ])
    );
  });

  it('derives parent progress and auto-completes ancestors only after every direct child completes', async () => {
    const parentAssignee = await registerIdentity('task-progress-parent');
    const firstAssignee = await registerIdentity('task-progress-first');
    const secondAssignee = await registerIdentity('task-progress-second');
    const parent = await createAssigned(parentAssignee.id, { title: 'Derived progress parent' });
    const parentId = stringField(parent, 'id');
    const decomposition = asObject(
      await parentAssignee.http.decomposeTask(parentId, {
        subtasks: [
          { title: 'First child', assigneeId: firstAssignee.id },
          { title: 'Second child', assigneeId: secondAssignee.id },
        ],
        idempotencyKey: `progress-decompose-${randomUUID()}`,
      })
    );
    const children = arrayField(decomposition, 'children').map((value) => asObject(value));
    expect(objectField(taskFrom(decomposition), 'progress')).toEqual({ total: 2, completed: 0 });
    expect(nullableStringField(children[0], 'roomId')).not.toBe(nullableStringField(children[1], 'roomId'));
    await parentAssignee.http.startTask(parentId, { idempotencyKey: `start-parent-${parentId}` });
    await expectSdkError(
      () =>
        parentAssignee.http.submitTask(parentId, {
          summary: 'This parent must wait for its children',
          idempotencyKey: `manual-parent-submit-${parentId}`,
        }),
      409,
      'invalid_task_transition'
    );

    const complete = async (assignee: RegisteredIdentity, child: JsonObject) => {
      const childId = stringField(child, 'id');
      await assignee.http.startTask(childId, { idempotencyKey: `start-${childId}` });
      await assignee.http.submitTask(childId, {
        summary: `Completed ${childId}`,
        idempotencyKey: `submit-${childId}`,
      });
    };
    await complete(firstAssignee, children[0]);
    let parentDetail = asObject(await owner.getTask(parentId));
    expect(taskFrom(parentDetail)).toMatchObject({ status: 'in_progress' });
    expect(objectField(taskFrom(parentDetail), 'progress')).toEqual({ total: 2, completed: 1 });

    await complete(secondAssignee, children[1]);
    parentDetail = asObject(await owner.getTask(parentId));
    expect(taskFrom(parentDetail)).toMatchObject({ status: 'completed' });
    expect(objectField(taskFrom(parentDetail), 'progress')).toEqual({ total: 2, completed: 2 });
    expect(arrayField(parentDetail, 'events')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'task.auto_completed' })])
    );
  });

  it('auto-completes both a decomposed parent and its root when a grandchild completes', async () => {
    const rootAssignee = await registerIdentity('task-recursive-root');
    const parentAssignee = await registerIdentity('task-recursive-parent');
    const grandchildAssignee = await registerIdentity('task-recursive-grandchild');
    const root = await createAssigned(rootAssignee.id, { title: 'Recursive completion root' });
    const rootId = stringField(root, 'id');
    const parent = asObject(
      arrayField(
        asObject(
          await rootAssignee.http.decomposeTask(rootId, {
            subtasks: [{ title: 'Recursive completion parent', assigneeId: parentAssignee.id }],
            idempotencyKey: `recursive-parent-${randomUUID()}`,
          })
        ),
        'children'
      )[0]
    );
    const parentId = stringField(parent, 'id');
    const grandchild = asObject(
      arrayField(
        asObject(
          await parentAssignee.http.decomposeTask(parentId, {
            subtasks: [{ title: 'Recursive completion grandchild', assigneeId: grandchildAssignee.id }],
            idempotencyKey: `recursive-grandchild-${randomUUID()}`,
          })
        ),
        'children'
      )[0]
    );
    const grandchildId = stringField(grandchild, 'id');

    await grandchildAssignee.http.startTask(grandchildId, {
      idempotencyKey: `start-recursive-grandchild-${grandchildId}`,
    });
    await grandchildAssignee.http.submitTask(grandchildId, {
      summary: 'The leaf task is complete',
      idempotencyKey: `submit-recursive-grandchild-${grandchildId}`,
    });

    const parentDetail = asObject(await parentAssignee.http.getTask(parentId));
    const rootDetail = asObject(await rootAssignee.http.getTask(rootId));
    expect(taskFrom(parentDetail)).toMatchObject({ status: 'completed' });
    expect(taskFrom(rootDetail)).toMatchObject({ status: 'completed' });
    expect(arrayField(parentDetail, 'events')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'task.auto_completed' })])
    );
    expect(arrayField(rootDetail, 'events')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'task.auto_completed' })])
    );
  });

  it('replays a decompose command without duplicate children and rejects conflicting replays', async () => {
    const parentAssignee = await registerIdentity('task-decompose-idempotency');
    const parent = await createAssigned(parentAssignee.id, { title: 'Idempotent decomposition parent' });
    const parentId = stringField(parent, 'id');
    const idempotencyKey = `decompose-replay-${randomUUID()}`;
    const request = {
      subtasks: [{ title: 'The only idempotent child' }],
      idempotencyKey,
    };

    const first = asObject(await parentAssignee.http.decomposeTask(parentId, request));
    const replay = asObject(await parentAssignee.http.decomposeTask(parentId, request));
    expect(replay).toEqual(first);
    expect(arrayField(asObject(await parentAssignee.http.getTask(parentId)), 'children')).toHaveLength(1);

    await expectSdkError(
      () =>
        parentAssignee.http.decomposeTask(parentId, {
          subtasks: [{ title: 'A conflicting child' }],
          idempotencyKey,
        }),
      409,
      'task_idempotency_conflict'
    );
  });

  it('caps nesting at two levels and records parent and child links immutably', async () => {
    const root = await createDraft({ title: 'Root decomposition task' });
    const rootId = stringField(root, 'id');
    const child = taskFrom(
      await owner.createTask({ title: 'Child task', parentTaskId: rootId })
    );
    const childId = stringField(child, 'id');
    const grandchildResponse = asObject(
      await owner.decomposeTask(childId, {
        subtasks: [{ title: 'Grandchild task' }],
        idempotencyKey: `grandchild-${randomUUID()}`,
      })
    );
    const grandchild = asObject(arrayField(grandchildResponse, 'children')[0]);
    expect(grandchild).toMatchObject({ parentTaskId: childId });
    const childDetail = asObject(await owner.getTask(childId));
    expect(objectField(childDetail, 'parentTask')).toMatchObject({ id: rootId });
    expect(arrayField(childDetail, 'events')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'task.decomposed' })])
    );
    await expectSdkError(
      () =>
        owner.decomposeTask(stringField(grandchild, 'id'), {
          subtasks: [{ title: 'Too deep' }],
          idempotencyKey: `too-deep-${randomUUID()}`,
        }),
      409,
      'task_depth_exceeded'
    );
  });

  it('cascades cancellation and failure from a parent to every open descendant', async () => {
    const cancellationOwner = await registerIdentity('task-cascade-cancel-parent');
    const cancellationChild = await registerIdentity('task-cascade-cancel-child');
    const cancellable = await createAssigned(cancellationOwner.id, { title: 'Cancellable parent' });
    const cancellableId = stringField(cancellable, 'id');
    const cancelledChild = asObject(
      arrayField(
        asObject(
          await cancellationOwner.http.decomposeTask(cancellableId, {
            subtasks: [{ title: 'Open child to cancel', assigneeId: cancellationChild.id }],
            idempotencyKey: `cancel-decompose-${randomUUID()}`,
          })
        ),
        'children'
      )[0]
    );
    await owner.cancelTask(cancellableId, {
      reason: 'Parent work was cancelled',
      idempotencyKey: `cancel-parent-${randomUUID()}`,
    });
    const cancelledDetail = asObject(
      await cancellationChild.http.getTask(stringField(cancelledChild, 'id'))
    );
    expect(taskFrom(cancelledDetail)).toMatchObject({ status: 'cancelled' });
    const cancellationEvent = asObject(
      arrayField(cancelledDetail, 'events').find(
        (event) => asObject(event, 'task event').kind === 'task.cancelled'
      ),
      'cascaded cancellation event'
    );
    expect(cancellationEvent).toMatchObject({
      metadata: { cascadedFromTaskId: cancellableId },
    });

    const failureOwner = await registerIdentity('task-cascade-fail-parent');
    const failureChild = await registerIdentity('task-cascade-fail-child');
    const failing = await createAssigned(failureOwner.id, { title: 'Failing parent' });
    const failingId = stringField(failing, 'id');
    const failedChild = asObject(
      arrayField(
        asObject(
          await failureOwner.http.decomposeTask(failingId, {
            subtasks: [{ title: 'Open child to fail', assigneeId: failureChild.id }],
            idempotencyKey: `fail-decompose-${randomUUID()}`,
          })
        ),
        'children'
      )[0]
    );
    await failureOwner.http.failTask(failingId, {
      reason: 'Parent work failed',
      idempotencyKey: `fail-parent-${randomUUID()}`,
    });
    const failedDetail = asObject(
      await failureChild.http.getTask(stringField(failedChild, 'id'))
    );
    expect(taskFrom(failedDetail)).toMatchObject({ status: 'failed' });
    const failureEvent = asObject(
      arrayField(failedDetail, 'events').find(
        (event) => asObject(event, 'task event').kind === 'task.failed'
      ),
      'cascaded failure event'
    );
    expect(failureEvent).toMatchObject({
      metadata: { cascadedFromTaskId: failingId },
    });
  });

  it('strips removed legacy fields on create and assign instead of rejecting old payloads', async () => {
    const assignee = await registerIdentity('task-legacy-assignee');

    const createRes = await rawApi('/api/v1/tasks', {
      title: `Legacy payload ${randomUUID()}`,
      description: 'Old client payload with removed fields',
      departmentId: randomUUID(),
      target: { type: 'participant', participantId: assignee.id },
      requiredSkillTags: ['mqtt'],
      reviewerId: ownerId,
      collaboratorIds: [assignee.id],
    });
    expect([200, 201]).toContain(createRes.status);
    const created = taskFrom(await createRes.json());
    expect(created).toMatchObject({ status: 'draft', creatorId: ownerId });
    for (const removed of ['departmentId', 'target', 'requiredSkillTags']) {
      expect(created).not.toHaveProperty(removed);
    }

    const taskId = stringField(created, 'id');
    const assignRes = await rawApi(`/api/v1/tasks/${encodeURIComponent(taskId)}/assignments`, {
      assigneeId: assignee.id,
      reviewerId: ownerId,
      collaboratorIds: [ownerId],
      idempotencyKey: `legacy-assign-${randomUUID()}`,
    });
    expect(assignRes.status).toBe(200);
    const assigned = taskFrom(await assignRes.json());
    expect(assigned).toMatchObject({ status: 'assigned', assigneeId: assignee.id });
    expect(assigned).not.toHaveProperty('reviewerId');
    expect(assigned).not.toHaveProperty('collaboratorIds');
  });

  it('restricts assignment to the creator acting as a human', async () => {
    const assignee = await registerIdentity('task-assign-restricted-assignee');
    const other = await registerIdentity('task-assign-restricted-other');
    const agent = await registerIdentity('task-assign-restricted-agent', 'agent', gateway.id);
    const agentActor = delegatedTaskSdk(server.baseUrl, gateway.token, agent.id);
    const draft = await createDraft();
    const taskId = stringField(draft, 'id');

    // 非 creator 不能指派
    await expectSdkStatus(
      () =>
        other.http.assignTask(taskId, {
          assigneeId: assignee.id,
          idempotencyKey: `non-creator-${randomUUID()}`,
        }),
      403
    );
    // creator 必须是 human（agent/gateway 经委托身份发起也不允许）
    await expectSdkStatus(
      () =>
        agentActor.assignTask(taskId, {
          assigneeId: assignee.id,
          idempotencyKey: `agent-confirm-${randomUUID()}`,
        }),
      403
    );
    // creator（human）可以指派
    expect(await assignDraft(taskId, assignee.id)).toMatchObject({
      status: 'assigned',
      assigneeId: assignee.id,
    });
  });

  it('lets a department leader delegate their assigned task only to staff in their department subtree', async () => {
    const leader = await registerIdentity('task-department-leader');
    const staff = await registerIdentity('task-department-staff');
    const outsider = await registerIdentity('task-department-outsider');
    const organization = owner as unknown as OpcHttpClient;
    const root = objectField(
      asObject(await organization.createDepartment({ name: `Task leadership ${randomUUID()}` })),
      'department'
    );
    const child = objectField(
      asObject(
        await organization.createDepartment({
          name: `Task leadership staff ${randomUUID()}`,
          parentId: stringField(root, 'id'),
        })
      ),
      'department'
    );
    const separate = objectField(
      asObject(await organization.createDepartment({ name: `Task leadership outside ${randomUUID()}` })),
      'department'
    );
    const [leaderPosition, staffPosition, outsiderPosition] = await Promise.all([
      organization.createPosition({ name: `Leader ${randomUUID()}`, departmentId: stringField(root, 'id') }),
      organization.createPosition({ name: `Staff ${randomUUID()}`, departmentId: stringField(child, 'id') }),
      organization.createPosition({ name: `Outsider ${randomUUID()}`, departmentId: stringField(separate, 'id') }),
    ]);
    await Promise.all([
      organization.createStaffAssignment(leader.id, {
        positionId: stringField(objectField(asObject(leaderPosition), 'position'), 'id'),
        isDepartmentLeader: true,
      }),
      organization.createStaffAssignment(staff.id, {
        positionId: stringField(objectField(asObject(staffPosition), 'position'), 'id'),
      }),
      organization.createStaffAssignment(outsider.id, {
        positionId: stringField(objectField(asObject(outsiderPosition), 'position'), 'id'),
      }),
    ]);

    const delegatedTask = await createAssigned(leader.id, { title: 'Department delegation' });
    const delegatedTaskId = stringField(delegatedTask, 'id');
    expect(
      taskFrom(
        await leader.http.assignTask(delegatedTaskId, {
          assigneeId: staff.id,
          idempotencyKey: `leader-delegates-${randomUUID()}`,
        })
      )
    ).toMatchObject({ assigneeId: staff.id, status: 'assigned' });

    const outOfScopeTask = await createAssigned(leader.id, { title: 'Out of scope delegation' });
    await expectSdkError(
      () =>
        leader.http.assignTask(stringField(outOfScopeTask, 'id'), {
          assigneeId: outsider.id,
          idempotencyKey: `leader-outside-${randomUUID()}`,
        }),
      403,
      'forbidden'
    );

    const unrelatedTask = await createAssigned(staff.id, { title: 'Unrelated assignment' });
    await expectSdkError(
      () =>
        leader.http.assignTask(stringField(unrelatedTask, 'id'), {
          assigneeId: staff.id,
          idempotencyKey: `leader-unrelated-${randomUUID()}`,
        }),
      403,
      'forbidden'
    );
  });

  it('reassigns back to assigned while preserving room, history, and old-assignee visibility', async () => {
    const first = await registerIdentity('task-reassign-first');
    const second = await registerIdentity('task-reassign-second');
    const task = await createAssigned(first.id);
    const taskId = stringField(task, 'id');
    const roomId = nullableStringField(task, 'roomId');
    if (!roomId) throw new Error('assignment must create a task room');
    await first.http.startTask(taskId, { idempotencyKey: 'reassign-start' });
    await first.http.blockTask(taskId, {
      reason: 'Needs another owner',
      idempotencyKey: 'reassign-block',
    });

    const reassigned = await assignDraft(taskId, second.id, `reassign-${randomUUID()}`);
    expect(reassigned).toMatchObject({
      status: 'assigned',
      assigneeId: second.id,
      roomId,
    });

    const detail = asObject(await first.http.getTask(taskId));
    const assignments = arrayField(detail, 'assignments');
    expect(assignments).toHaveLength(2);
    expect(asObject(assignments[0])).toMatchObject({ assigneeId: first.id });
    expect(stringField(asObject(assignments[0]), 'supersededAt')).toBeTruthy();

    const room = objectField(asObject(await owner.getRoom(roomId)), 'room');
    expect(arrayField(room, 'participantIds')).toEqual(
      expect.arrayContaining([ownerId, first.id, second.id])
    );

    await expectSdkError(
      () => first.http.startTask(taskId, { idempotencyKey: 'reassign-old-start' }),
      403,
      'forbidden'
    );
    expect(
      taskFrom(await second.http.startTask(taskId, { idempotencyKey: 'reassign-new-start' }))
    ).toMatchObject({ status: 'in_progress' });
  });

  it('runs submit directly to completed with complete immutable history and no review step', async () => {
    const assignee = await registerIdentity('task-flow-assignee');
    const task = await createAssigned(assignee.id, { title: 'Complete without review' });
    const taskId = stringField(task, 'id');

    expect(
      taskFrom(await assignee.http.startTask(taskId, { idempotencyKey: 'flow-start' }))
    ).toMatchObject({ status: 'in_progress' });
    await assignee.http.appendTaskEvent(taskId, {
      kind: 'decision',
      message: 'Use the transactional state-machine path',
      metadata: { decision: 'transaction' },
      idempotencyKey: 'flow-decision',
    });
    const completed = taskFrom(
      await assignee.http.submitTask(taskId, {
        summary: 'Result submitted once, completed directly',
        metadata: { revision: 1 },
        idempotencyKey: 'flow-submit',
      })
    );
    expect(completed).toMatchObject({ status: 'completed' });
    expect(stringField(completed, 'latestResultId')).toBeTruthy();
    expect(stringField(completed, 'completedAt')).toBeTruthy();

    const detail = asObject(await owner.getTask(taskId));
    expect(arrayField(detail, 'assignments')).toHaveLength(1);
    expect(arrayField(detail, 'results')).toEqual([
      expect.objectContaining({ summary: 'Result submitted once, completed directly' }),
    ]);
    expect(arrayField(detail, 'transitions').map((value) => asObject(value).to)).toEqual([
      'assigned',
      'in_progress',
      'completed',
    ]);
    expect(arrayField(detail, 'events')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'decision', actorId: assignee.id }),
      ])
    );
  });

  it('supports block/resume, fail, draft editing, cancellation, and terminal guards', async () => {
    const assignee = await registerIdentity('task-state-assignee');

    const first = await createAssigned(assignee.id);
    const firstId = stringField(first, 'id');
    await assignee.http.startTask(firstId, { idempotencyKey: 'state-start' });
    expect(
      taskFrom(
        await assignee.http.blockTask(firstId, {
          reason: 'Waiting for production access',
          idempotencyKey: 'state-block',
        })
      )
    ).toMatchObject({ status: 'blocked' });
    expect(
      taskFrom(
        await assignee.http.resumeTask(firstId, {
          reason: 'Access granted',
          idempotencyKey: 'state-resume',
        })
      )
    ).toMatchObject({ status: 'in_progress' });
    expect(
      taskFrom(
        await assignee.http.failTask(firstId, {
          reason: 'Dependency is irrecoverable',
          diagnostics: 'Safe diagnostic code E_DEPENDENCY',
          idempotencyKey: 'state-fail',
        })
      )
    ).toMatchObject({ status: 'failed' });
    await expectSdkError(
      () => assignee.http.startTask(firstId, { idempotencyKey: 'state-restart-terminal' }),
      409,
      'invalid_task_transition'
    );

    // fail 也可以直接从 assigned 发起
    const failFromAssigned = await createAssigned(assignee.id);
    expect(
      taskFrom(
        await assignee.http.failTask(stringField(failFromAssigned, 'id'), {
          reason: 'Cannot start',
          idempotencyKey: 'state-fail-assigned',
        })
      )
    ).toMatchObject({ status: 'failed' });

    // draft 编辑与取消
    const second = await createDraft({ title: 'Draft before edit' });
    const secondId = stringField(second, 'id');
    expect(
      taskFrom(
        await owner.updateTask(secondId, {
          title: 'Edited draft',
          description: 'Edited description',
        })
      )
    ).toMatchObject({ title: 'Edited draft', description: 'Edited description' });
    expect(
      taskFrom(
        await owner.cancelTask(secondId, {
          reason: 'No longer needed',
          idempotencyKey: 'state-cancel',
        })
      )
    ).toMatchObject({ status: 'cancelled' });
    await expectSdkError(
      () => owner.updateTask(secondId, { title: 'Too late' }),
      409,
      'task_not_draft'
    );

    // cancel 允许从任意非终态发起（这里从 in_progress 取消）
    const third = await createAssigned(assignee.id);
    const thirdId = stringField(third, 'id');
    await assignee.http.startTask(thirdId, { idempotencyKey: 'state-start-cancel' });
    expect(
      taskFrom(
        await owner.cancelTask(thirdId, {
          reason: 'Priority changed',
          idempotencyKey: 'state-cancel-in-progress',
        })
      )
    ).toMatchObject({ status: 'cancelled' });
  });

  it('rejects invalid transitions and commands from the wrong role', async () => {
    const assignee = await registerIdentity('task-invalid-assignee');
    const other = await registerIdentity('task-invalid-other');
    const task = await createAssigned(assignee.id);
    const taskId = stringField(task, 'id');

    // assigned 状态不能直接 submit（必须先 start）
    await expectSdkError(
      () =>
        assignee.http.submitTask(taskId, {
          summary: 'Too early',
          idempotencyKey: 'invalid-early-submit',
        }),
      409,
      'invalid_task_transition'
    );
    // 只有当前 assignee 能执行 start/block/resume/submit/fail
    await expectSdkError(
      () => other.http.startTask(taskId, { idempotencyKey: 'invalid-other-start' }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () =>
        owner.submitTask(taskId, { summary: 'Not the assignee', idempotencyKey: 'invalid-submit' }),
      403,
      'forbidden'
    );
    // 只有 creator 能 update / cancel / assign
    await expectSdkError(
      () => other.http.updateTask(taskId, { title: 'Not mine' }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () =>
        other.http.cancelTask(taskId, { reason: 'Not mine', idempotencyKey: 'invalid-cancel' }),
      403,
      'forbidden'
    );
  });

  it('restricts read visibility to the creator, the assignee, and task-room members', async () => {
    const creator = await registerIdentity('task-visible-creator');
    const assignee = await registerIdentity('task-visible-assignee');
    const outsider = await registerIdentity('task-visible-outsider');
    const task = await createAssigned(assignee.id, {}, creator.http);
    const taskId = stringField(task, 'id');

    for (const actor of [creator, assignee]) {
      expect(taskFrom(await actor.http.getTask(taskId))).toMatchObject({ id: taskId });
      expect(
        arrayField(asObject(await actor.http.listTasks()), 'tasks').some(
          (value) => asObject(value).id === taskId
        )
      ).toBe(true);
    }

    expect(
      arrayField(asObject(await outsider.http.listTasks()), 'tasks').some(
        (value) => asObject(value).id === taskId
      )
    ).toBe(false);
    await expectSdkError(() => outsider.http.getTask(taskId), 404, 'task_not_found');
  });

  it('filters listTasks by status, creatorId, and assigneeId', async () => {
    const assigneeA = await registerIdentity('task-filter-assignee-a');
    const assigneeB = await registerIdentity('task-filter-assignee-b');
    const draft = await createDraft({ title: `Filter draft ${randomUUID()}` });
    const assignedA = await createAssigned(assigneeA.id);
    const assignedB = await createAssigned(assigneeB.id);
    const draftId = stringField(draft, 'id');
    const assignedAId = stringField(assignedA, 'id');
    const assignedBId = stringField(assignedB, 'id');

    const listIds = async (query: {
      status?: TaskStatus;
      creatorId?: string;
      assigneeId?: string;
    }): Promise<string[]> =>
      arrayField(asObject(await owner.listTasks(query)), 'tasks').map((value) =>
        stringField(asObject(value), 'id')
      );

    const drafts = await listIds({ status: 'draft' });
    expect(drafts).toContain(draftId);
    expect(drafts).not.toContain(assignedAId);
    expect(drafts).not.toContain(assignedBId);

    const forA = await listIds({ assigneeId: assigneeA.id });
    expect(forA).toContain(assignedAId);
    expect(forA).not.toContain(assignedBId);
    expect(forA).not.toContain(draftId);

    const mine = await listIds({ creatorId: ownerId });
    expect(mine).toEqual(expect.arrayContaining([draftId, assignedAId, assignedBId]));

    const nobody = await listIds({ creatorId: assigneeA.id });
    expect(nobody).not.toContain(draftId);
  });

  it('deduplicates command retries and rejects conflicting idempotency-key reuse', async () => {
    const assignee = await registerIdentity('task-idempotent-assignee');
    const replacement = await registerIdentity('task-idempotent-replacement');
    const task = await createDraft();
    const taskId = stringField(task, 'id');
    const key = `same-assignment-${randomUUID()}`;

    const first = await assignDraft(taskId, assignee.id, key);
    const retried = await assignDraft(taskId, assignee.id, key);
    expect(retried).toEqual(first);
    await expectSdkError(
      () => assignDraft(taskId, replacement.id, key),
      409,
      'task_idempotency_conflict'
    );

    const started = await assignee.http.startTask(taskId, { idempotencyKey: 'same-start' });
    expect(await assignee.http.startTask(taskId, { idempotencyKey: 'same-start' })).toEqual(started);
    const submitted = await assignee.http.submitTask(taskId, {
      summary: 'One result only',
      idempotencyKey: 'same-submit',
    });
    expect(
      await assignee.http.submitTask(taskId, {
        summary: 'One result only',
        idempotencyKey: 'same-submit',
      })
    ).toEqual(submitted);

    const detail = asObject(await owner.getTask(taskId));
    expect(arrayField(detail, 'assignments')).toHaveLength(1);
    expect(arrayField(detail, 'results')).toHaveLength(1);
    expect(
      arrayField(detail, 'transitions').filter((value) => asObject(value).to === 'in_progress')
    ).toHaveLength(1);
    expect(
      arrayField(detail, 'transitions').filter((value) => asObject(value).to === 'completed')
    ).toHaveLength(1);
  });

  it('serializes competing transitions so exactly one command wins', async () => {
    const assignee = await registerIdentity('task-concurrent-assignee');
    const task = await createAssigned(assignee.id);
    const taskId = stringField(task, 'id');

    const outcomes = await Promise.allSettled([
      assignee.http.startTask(taskId, { idempotencyKey: 'concurrent-start-a' }),
      assignee.http.startTask(taskId, { idempotencyKey: 'concurrent-start-b' }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (!rejected || rejected.status !== 'rejected') throw new Error('expected rejected command');
    expect(rejected.reason).toEqual(
      expect.objectContaining({ status: 409, code: 'invalid_task_transition' })
    );

    const detail = asObject(await owner.getTask(taskId));
    expect(taskFrom(detail)).toMatchObject({ status: 'in_progress' });
    expect(
      arrayField(detail, 'transitions').filter((value) => asObject(value).to === 'in_progress')
    ).toHaveLength(1);
  });

  it('publishes task.event through the authorized task room without a new MQTT topic', async () => {
    const assignee = await registerIdentity('task-realtime-agent', 'agent', gateway.id);
    const task = await createAssigned(assignee.id);
    const taskId = stringField(task, 'id');
    const roomId = nullableStringField(task, 'roomId');
    if (!roomId) throw new Error('assignment must create a task room');
    const mqtt = await connectSdkClient(ownerId, ownerToken);

    try {
      await mqtt.subscribeRoom(roomId);
      const delivered = waitForTaskEvent(
        mqtt,
        (event) => event.taskId === taskId && objectField(event, 'event').kind === 'task.started'
      );
      await assignee.http.startTask(taskId, { idempotencyKey: 'realtime-start' });
      expect(await delivered).toMatchObject({
        type: 'task.event',
        roomId,
        taskId,
        event: {
          kind: 'task.started',
          actorId: assignee.id,
        },
      });
    } finally {
      await mqtt.disconnect();
    }
  }, 40_000);

  it('#106 persists exactly one executable task dispatch for idempotent assignment replay', async () => {
    const assignee = await registerIdentity('task-dispatch-agent', 'agent', gateway.id);
    const draft = await createDraft({ title: 'Prepare release' });
    const taskId = stringField(draft, 'id');
    const idempotencyKey = `dispatch-${randomUUID()}`;
    const assigned = await assignDraft(taskId, assignee.id, idempotencyKey);
    expect(await assignDraft(taskId, assignee.id, idempotencyKey)).toEqual(assigned);
    const roomId = nullableStringField(assigned, 'roomId');
    if (!roomId) throw new Error('assignment must create a task room');

    const detail = asObject(await owner.getTask(taskId));
    const assignmentId = stringField(asObject(arrayField(detail, 'assignments')[0]), 'id');
    const history = asObject(await owner.getHistory(roomId));
    const dispatches = arrayField(history, 'messages')
      .map((message) => asObject(message))
      .filter((message) => message.intent === 'task');

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      roomId,
      from: ownerId,
      intent: 'task',
      metadata: {
        opcTask: {
          kind: 'assignment',
          taskId,
          assignmentId,
          assigneeId: assignee.id,
        },
      },
    });
    expect(stringField(objectField(dispatches[0], 'content'), 'body')).toContain(
      'Prepare release'
    );
    expect(stringField(objectField(dispatches[0], 'content'), 'body')).toContain(
      'Acceptance task description'
    );
  });

  it('#106 allows only the owning gateway to act as the current assigned agent and rejects stale callbacks', async () => {
    const assignee = await registerIdentity('task-callback-agent', 'agent', gateway.id);
    const attacker = await registerIdentity('task-callback-attacker-gateway', 'gateway');
    const task = await createAssigned(assignee.id, { title: 'Run callback flow' });
    const taskId = stringField(task, 'id');
    let detail = asObject(await owner.getTask(taskId));
    const firstAssignmentId = stringField(
      asObject(arrayField(detail, 'assignments').at(-1)),
      'id'
    );
    const agent = delegatedTaskSdk(server.baseUrl, gateway.token, assignee.id);
    const spoofed = delegatedTaskSdk(server.baseUrl, attacker.token, assignee.id);

    await expectSdkError(
      () =>
        spoofed.startTask(taskId, {
          idempotencyKey: 'spoofed-start',
          assignmentId: firstAssignmentId,
        }),
      403,
      'forbidden'
    );
    expect(
      taskFrom(
        await agent.startTask(taskId, {
          idempotencyKey: 'agent-start',
          assignmentId: firstAssignmentId,
        })
      )
    ).toMatchObject({ status: 'in_progress' });

    await assignDraft(taskId, assignee.id, `reassign-same-agent-${randomUUID()}`);
    detail = asObject(await owner.getTask(taskId));
    const secondAssignmentId = stringField(
      asObject(arrayField(detail, 'assignments').at(-1)),
      'id'
    );
    expect(secondAssignmentId).not.toBe(firstAssignmentId);
    await expectSdkError(
      () =>
        agent.startTask(taskId, {
          idempotencyKey: 'stale-agent-start',
          assignmentId: firstAssignmentId,
        }),
      409,
      'stale_task_assignment'
    );
    expect(
      taskFrom(
        await agent.startTask(taskId, {
          idempotencyKey: 'current-agent-start',
          assignmentId: secondAssignmentId,
        })
      )
    ).toMatchObject({ status: 'in_progress' });
  });

  it('returns 410 Gone with a migration pointer for removed recommend/approve/reject routes', async () => {
    const assignee = await registerIdentity('task-gone-assignee');
    const task = await createAssigned(assignee.id);
    const taskId = encodeURIComponent(stringField(task, 'id'));

    for (const route of ['recommendations', 'approve', 'reject']) {
      const res = await rawApi(`/api/v1/tasks/${taskId}/${route}`, {
        idempotencyKey: `gone-${route}-${randomUUID()}`,
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      // 迁移指引：响应体必须指向新流程（直接指派 / submit 直接完成）
      expect(JSON.stringify(body)).toMatch(/assign|submit|migrat|removed/i);
    }
  });

  it('installs task persistence tables without legacy department/reviewer columns in a fresh schema', async () => {
    const db = createDbClient(scopedDatabaseUrl);
    try {
      const tables = await db.$client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name LIKE 'task%'
         ORDER BY table_name`
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'task_assignments',
        'task_command_receipts',
        'task_dependencies',
        'task_events',
        'task_results',
        'task_transitions',
        'tasks',
      ]);

      const columns = await db.$client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name IN ('tasks', 'task_assignments')`
      );
      const byTable = new Map<string, string[]>();
      for (const row of columns.rows) {
        byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name]);
      }
      for (const removed of ['department_id', 'target', 'required_skill_tags', 'reviewer_id', 'collaborator_ids']) {
        expect(byTable.get('tasks') ?? []).not.toContain(removed);
        expect(byTable.get('task_assignments') ?? []).not.toContain(removed);
      }
    } finally {
      await db.$client.end();
    }
  });
});
