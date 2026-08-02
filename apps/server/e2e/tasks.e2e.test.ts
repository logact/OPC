import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@opc/database';
import { OpcClient, OpcHttpClient } from '@logact-pub/opc-sdk';
import {
  DEFAULT_PASSWORD,
  connectSdkClient,
  startTestServer,
  type TestServer,
} from './helpers.js';

type JsonObject = Record<string, unknown>;
type ParticipantKind = 'human' | 'agent' | 'gateway';
type ScopeType = 'self' | 'department' | 'department_subtree' | 'organization';
type TaskStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface CapabilityGrantInput {
  capability: string;
  scope: { type: ScopeType };
}

interface TaskTargetInput {
  type: 'participant' | 'position' | 'department';
  participantId?: string;
  positionId?: string;
  departmentId?: string;
  includeDescendants?: boolean;
}

interface FutureTaskSdk {
  registerParticipant(
    id: string,
    name?: string,
    password?: string,
    kind?: ParticipantKind,
    gatewayId?: string
  ): Promise<unknown>;
  login(participantId: string, password: string): Promise<unknown>;
  createDepartment(request: { name: string; parentId?: string | null }): Promise<unknown>;
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
  createTask(request: {
    title: string;
    description?: string;
    departmentId: string;
    target?: TaskTargetInput;
    requiredSkillTags?: string[];
  }): Promise<unknown>;
  listTasks(query?: {
    status?: TaskStatus;
    departmentId?: string;
    creatorId?: string;
    assigneeId?: string;
    reviewerId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  getTask(taskId: string): Promise<unknown>;
  updateTask(
    taskId: string,
    request: {
      title?: string;
      description?: string;
      target?: TaskTargetInput | null;
      requiredSkillTags?: string[];
    }
  ): Promise<unknown>;
  recommendTask(taskId: string): Promise<unknown>;
  assignTask(
    taskId: string,
    request: {
      assigneeId: string;
      collaboratorIds?: string[];
      reviewerId: string;
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
  approveTask(
    taskId: string,
    request: { comment?: string; idempotencyKey: string }
  ): Promise<unknown>;
  rejectTask(
    taskId: string,
    request: { feedback: string; idempotencyKey: string }
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

describe('First-class task domain (issue #109)', () => {
  const baseDatabaseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc';
  const schemaName = `opc_tasks_e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const scopedDatabaseUrl = databaseUrlWithSchema(baseDatabaseUrl, schemaName);
  const admin = createDbClient(baseDatabaseUrl);
  const suffix = randomUUID();
  let server: TestServer;
  let publicHttp: FutureTaskSdk;
  let owner: FutureTaskSdk;
  let ownerId: string;
  let ownerToken: string;
  let gateway: RegisteredIdentity;

  beforeAll(async () => {
    await admin.$client.query(`CREATE SCHEMA "${schemaName}"`);
    server = await startTestServer(scopedDatabaseUrl, {
      authorizationMode: 'enforce',
      migrationsSchema: schemaName,
    });
    publicHttp = taskSdk(new OpcHttpClient(server.baseUrl));
    ownerId = `task-owner-${suffix}`;
    const registration = asObject(
      await publicHttp.registerParticipant(ownerId, 'Task Owner', DEFAULT_PASSWORD)
    );
    ownerToken = stringField(registration, 'token');
    const login = asObject(await publicHttp.login(ownerId, DEFAULT_PASSWORD));
    owner = taskSdk(new OpcHttpClient(server.baseUrl, stringField(login, 'accessToken')));
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

  async function createDepartment(name: string, parentId: string | null = null): Promise<string> {
    return stringField(
      objectField(asObject(await owner.createDepartment({ name, parentId })), 'department'),
      'id'
    );
  }

  async function createPosition(
    departmentId: string,
    options: {
      skillTags?: string[];
      grants?: CapabilityGrantInput[];
      name?: string;
    } = {}
  ): Promise<string> {
    const response = asObject(
      await owner.createPosition({
        departmentId,
        name: options.name ?? `Task position ${randomUUID()}`,
        responsibilities: [],
        skillTags: options.skillTags ?? [],
        capabilityGrants: options.grants ?? [],
      })
    );
    return stringField(objectField(response, 'position'), 'id');
  }

  async function assignPosition(
    participantId: string,
    positionId: string,
    isDepartmentLeader = false
  ): Promise<void> {
    await owner.createStaffAssignment(participantId, { positionId, isDepartmentLeader });
  }

  async function createStaff(
    prefix: string,
    departmentId: string,
    options: {
      kind?: 'human' | 'agent';
      skillTags?: string[];
      grants?: CapabilityGrantInput[];
      positionId?: string;
      leader?: boolean;
    } = {}
  ): Promise<RegisteredIdentity> {
    const participant = await registerIdentity(
      prefix,
      options.kind ?? 'human',
      options.kind === 'agent' ? gateway.id : undefined
    );
    const positionId =
      options.positionId ??
      (await createPosition(departmentId, {
        skillTags: options.skillTags,
        grants: options.grants,
      }));
    await assignPosition(participant.id, positionId, options.leader);
    return participant;
  }

  async function createDraft(
    departmentId: string,
    options: {
      title?: string;
      target?: TaskTargetInput;
      requiredSkillTags?: string[];
    } = {},
    actor: FutureTaskSdk = owner
  ): Promise<JsonObject> {
    return taskFrom(
      await actor.createTask({
        title: options.title ?? `Task ${randomUUID()}`,
        description: 'Acceptance task description',
        departmentId,
        target: options.target,
        requiredSkillTags: options.requiredSkillTags ?? [],
      })
    );
  }

  async function assignDraft(
    taskId: string,
    assigneeId: string,
    reviewerId: string,
    collaboratorIds: string[] = [],
    key = `assign-${randomUUID()}`,
    actor: FutureTaskSdk = owner
  ): Promise<JsonObject> {
    return taskFrom(
      await actor.assignTask(taskId, {
        assigneeId,
        collaboratorIds,
        reviewerId,
        idempotencyKey: key,
      })
    );
  }

  it('runs submit, reject, resubmit, and approve with complete immutable history', async () => {
    const departmentId = await createDepartment(`Human flow ${randomUUID()}`);
    const assignee = await createStaff('task-flow-assignee', departmentId, {
      skillTags: ['typescript', 'mqtt'],
    });
    const collaborator = await createStaff('task-flow-collaborator', departmentId);
    const reviewer = await createStaff('task-flow-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const draft = await createDraft(departmentId, { requiredSkillTags: ['MQTT', 'TypeScript'] });
    const taskId = stringField(draft, 'id');

    expect(draft).toMatchObject({
      status: 'draft',
      creatorId: ownerId,
      requiredSkillTags: ['mqtt', 'typescript'],
      assigneeId: null,
      roomId: null,
    });

    const assigned = await assignDraft(
      taskId,
      assignee.id,
      reviewer.id,
      [collaborator.id]
    );
    expect(assigned).toMatchObject({
      status: 'assigned',
      assigneeId: assignee.id,
      collaboratorIds: [collaborator.id],
      reviewerId: reviewer.id,
    });
    expect(nullableStringField(assigned, 'roomId')).toBeTruthy();

    expect(taskFrom(await assignee.http.startTask(taskId, { idempotencyKey: 'flow-start' }))).toMatchObject({
      status: 'in_progress',
    });
    await assignee.http.appendTaskEvent(taskId, {
      kind: 'decision',
      message: 'Use the transactional state-machine path',
      metadata: { decision: 'transaction' },
      idempotencyKey: 'flow-decision',
    });
    expect(
      taskFrom(
        await assignee.http.submitTask(taskId, {
          summary: 'First result',
          metadata: { revision: 1 },
          idempotencyKey: 'flow-submit-1',
        })
      )
    ).toMatchObject({ status: 'review' });
    expect(
      taskFrom(
        await reviewer.http.rejectTask(taskId, {
          feedback: 'Add concurrency coverage',
          idempotencyKey: 'flow-reject',
        })
      )
    ).toMatchObject({ status: 'in_progress' });
    await assignee.http.submitTask(taskId, {
      summary: 'Second result with concurrency coverage',
      metadata: { revision: 2 },
      idempotencyKey: 'flow-submit-2',
    });
    expect(
      taskFrom(
        await reviewer.http.approveTask(taskId, {
          comment: 'Acceptance complete',
          idempotencyKey: 'flow-approve',
        })
      )
    ).toMatchObject({ status: 'completed' });

    const detail = asObject(await owner.getTask(taskId));
    expect(arrayField(detail, 'assignments')).toHaveLength(1);
    expect(arrayField(detail, 'results')).toEqual([
      expect.objectContaining({ summary: 'First result' }),
      expect.objectContaining({ summary: 'Second result with concurrency coverage' }),
    ]);
    expect(
      arrayField(detail, 'transitions').map((value) => asObject(value).to)
    ).toEqual(['assigned', 'in_progress', 'review', 'in_progress', 'review', 'completed']);
    expect(arrayField(detail, 'events')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'decision', actorId: assignee.id }),
        expect.objectContaining({ kind: 'task.rejected', actorId: reviewer.id }),
        expect.objectContaining({ kind: 'task.approved', actorId: reviewer.id }),
      ])
    );
  });

  it('supports block/resume, failure, draft editing, cancellation, and terminal guards', async () => {
    const departmentId = await createDepartment(`Side states ${randomUUID()}`);
    const assignee = await createStaff('task-state-assignee', departmentId);
    const reviewer = await createStaff('task-state-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const first = await createDraft(departmentId);
    const firstId = stringField(first, 'id');
    await assignDraft(firstId, assignee.id, reviewer.id);
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

    const second = await createDraft(departmentId, { title: 'Draft before edit' });
    const secondId = stringField(second, 'id');
    expect(
      taskFrom(
        await owner.updateTask(secondId, {
          title: 'Edited draft',
          requiredSkillTags: ['Zod', 'zod'],
        })
      )
    ).toMatchObject({ title: 'Edited draft', requiredSkillTags: ['zod'] });
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
  });

  it('recommends only target/scope/skill eligible staff in deterministic availability order', async () => {
    const root = await createDepartment(`Recommend root ${randomUUID()}`);
    const child = await createDepartment(`Recommend child ${randomUUID()}`, root);
    const outside = await createDepartment(`Recommend outside ${randomUUID()}`);
    const targetPosition = await createPosition(child, {
      skillTags: ['mqtt', 'typescript'],
      name: `Target engineers ${randomUUID()}`,
    });
    const available = await createStaff('task-recommend-available', child, {
      positionId: targetPosition,
    });
    const offline = await createStaff('task-recommend-offline', child, {
      positionId: targetPosition,
    });
    const missingSkill = await createStaff('task-recommend-missing', child, {
      skillTags: ['typescript'],
    });
    const outOfScope = await createStaff('task-recommend-outside', outside, {
      skillTags: ['mqtt', 'typescript'],
    });
    const reviewer = await createStaff('task-recommend-reviewer', child, {
      skillTags: ['mqtt', 'typescript'],
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const onlineClient = await connectSdkClient(available.id, available.token);

    try {
      const draft = await createDraft(root, {
        target: { type: 'position', positionId: targetPosition },
        requiredSkillTags: ['typescript', 'mqtt'],
      });
      const taskId = stringField(draft, 'id');
      const recommendationResponse = asObject(await owner.recommendTask(taskId));
      const recommendations = arrayField(recommendationResponse, 'recommendations').map((value) =>
        asObject(value)
      );

      expect(recommendations.map((candidate) => candidate.participantId)).toEqual([
        available.id,
        offline.id,
      ]);
      expect(recommendations[0]).toMatchObject({
        participantId: available.id,
        targetMatch: 'position',
        matchedSkillTags: ['mqtt', 'typescript'],
        availability: 'idle',
      });
      expect(arrayField(recommendations[0], 'reasons')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'target.position' }),
          expect.objectContaining({ code: 'skills.required' }),
          expect.objectContaining({ code: 'availability.idle' }),
        ])
      );
      expect(recommendations.map((candidate) => candidate.participantId)).not.toContain(
        missingSkill.id
      );
      expect(recommendations.map((candidate) => candidate.participantId)).not.toContain(
        outOfScope.id
      );
      expect(recommendations.map((candidate) => candidate.participantId)).not.toContain(
        reviewer.id
      );
      expect(taskFrom(await owner.getTask(taskId))).toMatchObject({
        status: 'draft',
        assigneeId: null,
        roomId: null,
      });
    } finally {
      await onlineClient.disconnect();
    }
  }, 40_000);

  it('enforces direct-participant and management-chain visibility without leaking hidden tasks', async () => {
    const root = await createDepartment(`Visibility root ${randomUUID()}`);
    const child = await createDepartment(`Visibility child ${randomUUID()}`, root);
    const sibling = await createDepartment(`Visibility sibling ${randomUUID()}`);
    const creator = await createStaff('task-visible-creator', child, {
      grants: [
        { capability: 'task.create', scope: { type: 'department' } },
        { capability: 'task.read', scope: { type: 'self' } },
      ],
    });
    const assignee = await createStaff('task-visible-assignee', child);
    const collaborator = await createStaff('task-visible-collaborator', child);
    const reviewer = await createStaff('task-visible-reviewer', child, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const manager = await createStaff('task-visible-manager', root, {
      grants: [{ capability: 'task.read', scope: { type: 'department_subtree' } }],
    });
    const outsider = await createStaff('task-visible-outsider', sibling, {
      grants: [{ capability: 'task.read', scope: { type: 'department' } }],
    });
    const task = await createDraft(child, {}, creator.http);
    const taskId = stringField(task, 'id');
    await assignDraft(taskId, assignee.id, reviewer.id, [collaborator.id]);

    for (const actor of [creator, assignee, collaborator, reviewer, manager]) {
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

  it('rejects invalid actors, role overlap, stale eligibility, and unauthorized transitions', async () => {
    const departmentId = await createDepartment(`Invalid actors ${randomUUID()}`);
    const assignee = await createStaff('task-invalid-assignee', departmentId, {
      skillTags: ['required'],
    });
    const other = await createStaff('task-invalid-other', departmentId);
    const collaborator = await createStaff('task-invalid-collaborator', departmentId);
    const reviewer = await createStaff('task-invalid-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const agentAssigner = await createStaff('task-invalid-agent-assigner', departmentId, {
      kind: 'agent',
      grants: [{ capability: 'task.assign', scope: { type: 'department' } }],
    });
    const task = await createDraft(departmentId, { requiredSkillTags: ['required'] });
    const taskId = stringField(task, 'id');

    await expectSdkError(
      () =>
        owner.assignTask(taskId, {
          assigneeId: assignee.id,
          collaboratorIds: [assignee.id],
          reviewerId: reviewer.id,
          idempotencyKey: 'invalid-overlap',
        }),
      422,
      'invalid_task_roles'
    );
    await expectSdkError(
      () =>
        owner.assignTask(taskId, {
          assigneeId: gateway.id,
          reviewerId: reviewer.id,
          idempotencyKey: 'invalid-gateway',
        }),
      422,
      'invalid_task_participant'
    );
    await expectSdkError(
      () =>
        owner.assignTask(taskId, {
          assigneeId: other.id,
          reviewerId: reviewer.id,
          idempotencyKey: 'invalid-skill',
        }),
      422,
      'task_candidate_ineligible'
    );
    await expectSdkError(
      () =>
        agentAssigner.http.assignTask(taskId, {
          assigneeId: assignee.id,
          reviewerId: reviewer.id,
          idempotencyKey: 'invalid-agent-confirmation',
        }),
      403,
      'human_confirmation_required'
    );

    await assignDraft(taskId, assignee.id, reviewer.id, [collaborator.id]);
    await expectSdkError(
      () => collaborator.http.startTask(taskId, { idempotencyKey: 'invalid-collab-start' }),
      403,
      'forbidden'
    );
    await expectSdkError(
      () => reviewer.http.approveTask(taskId, { idempotencyKey: 'invalid-early-approve' }),
      409,
      'invalid_task_transition'
    );
    await expectSdkError(
      () => owner.submitTask(taskId, { summary: 'Not the assignee', idempotencyKey: 'invalid-submit' }),
      403,
      'forbidden'
    );
  });

  it('deduplicates command retries and rejects conflicting idempotency-key reuse', async () => {
    const departmentId = await createDepartment(`Idempotency ${randomUUID()}`);
    const assignee = await createStaff('task-idempotent-assignee', departmentId);
    const replacement = await createStaff('task-idempotent-replacement', departmentId);
    const reviewer = await createStaff('task-idempotent-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const task = await createDraft(departmentId);
    const taskId = stringField(task, 'id');
    const key = `same-assignment-${randomUUID()}`;

    const first = await assignDraft(taskId, assignee.id, reviewer.id, [], key);
    const retried = await assignDraft(taskId, assignee.id, reviewer.id, [], key);
    expect(retried).toEqual(first);
    await expectSdkError(
      () => assignDraft(taskId, replacement.id, reviewer.id, [], key),
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
      arrayField(detail, 'transitions').filter((value) => asObject(value).to === 'review')
    ).toHaveLength(1);
  });

  it('serializes competing transitions so exactly one command wins', async () => {
    const departmentId = await createDepartment(`Concurrency ${randomUUID()}`);
    const assignee = await createStaff('task-concurrent-assignee', departmentId);
    const reviewer = await createStaff('task-concurrent-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const task = await createDraft(departmentId);
    const taskId = stringField(task, 'id');
    await assignDraft(taskId, assignee.id, reviewer.id);

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

  it('reassigns through one room while preserving history and old-assignee visibility', async () => {
    const departmentId = await createDepartment(`Reassign ${randomUUID()}`);
    const first = await createStaff('task-reassign-first', departmentId);
    const second = await createStaff('task-reassign-second', departmentId);
    const reviewer = await createStaff('task-reassign-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const task = await createDraft(departmentId);
    const taskId = stringField(task, 'id');
    const assigned = await assignDraft(taskId, first.id, reviewer.id);
    const roomId = nullableStringField(assigned, 'roomId');
    if (!roomId) throw new Error('assignment must create a task room');
    await first.http.startTask(taskId, { idempotencyKey: 'reassign-start' });
    await first.http.blockTask(taskId, {
      reason: 'Needs another owner',
      idempotencyKey: 'reassign-block',
    });

    const reassigned = await assignDraft(
      taskId,
      second.id,
      reviewer.id,
      [],
      'reassign-command'
    );
    expect(reassigned).toMatchObject({
      status: 'assigned',
      assigneeId: second.id,
      roomId,
    });
    const detail = asObject(await first.http.getTask(taskId));
    expect(arrayField(detail, 'assignments')).toHaveLength(2);
    const firstAssignment = asObject(arrayField(detail, 'assignments')[0]);
    expect(firstAssignment).toMatchObject({ assigneeId: first.id });
    expect(stringField(firstAssignment, 'supersededAt')).toBeTruthy();
    const room = objectField(asObject(await owner.getRoom(roomId)), 'room');
    expect(arrayField(room, 'participantIds')).toEqual(
      expect.arrayContaining([ownerId, first.id, second.id, reviewer.id])
    );
    await expectSdkError(
      () => first.http.startTask(taskId, { idempotencyKey: 'reassign-old-start' }),
      403,
      'forbidden'
    );
    expect(taskFrom(await second.http.startTask(taskId, { idempotencyKey: 'reassign-new-start' }))).toMatchObject({
      status: 'in_progress',
    });
  });

  it('publishes task.event through the authorized task room without a new MQTT topic', async () => {
    const departmentId = await createDepartment(`Realtime ${randomUUID()}`);
    const assignee = await createStaff('task-realtime-agent', departmentId, { kind: 'agent' });
    const reviewer = await createStaff('task-realtime-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const task = await createDraft(departmentId);
    const taskId = stringField(task, 'id');
    const assigned = await assignDraft(taskId, assignee.id, reviewer.id);
    const roomId = nullableStringField(assigned, 'roomId');
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
    const departmentId = await createDepartment(`Agent dispatch ${randomUUID()}`);
    const assignee = await createStaff('task-dispatch-agent', departmentId, { kind: 'agent' });
    const reviewer = await createStaff('task-dispatch-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const draft = await createDraft(departmentId, { title: 'Prepare release' });
    const taskId = stringField(draft, 'id');
    const idempotencyKey = `dispatch-${randomUUID()}`;
    const assigned = await assignDraft(
      taskId,
      assignee.id,
      reviewer.id,
      [],
      idempotencyKey
    );
    expect(await assignDraft(taskId, assignee.id, reviewer.id, [], idempotencyKey)).toEqual(
      assigned
    );
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
    const departmentId = await createDepartment(`Agent callback ${randomUUID()}`);
    const assignee = await createStaff('task-callback-agent', departmentId, { kind: 'agent' });
    const reviewer = await createStaff('task-callback-reviewer', departmentId, {
      grants: [{ capability: 'task.review', scope: { type: 'self' } }],
    });
    const attacker = await registerIdentity('task-callback-attacker-gateway', 'gateway');
    const draft = await createDraft(departmentId, { title: 'Run callback flow' });
    const taskId = stringField(draft, 'id');
    await assignDraft(taskId, assignee.id, reviewer.id);
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

    await assignDraft(
      taskId,
      assignee.id,
      reviewer.id,
      [],
      `reassign-same-agent-${randomUUID()}`
    );
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

  it('installs all task persistence tables in a fresh schema', async () => {
    const db = createDbClient(scopedDatabaseUrl);
    try {
      const result = await db.$client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name LIKE 'task%'
         ORDER BY table_name`
      );
      expect(result.rows.map((row) => row.table_name)).toEqual([
        'task_assignments',
        'task_command_receipts',
        'task_events',
        'task_results',
        'task_transitions',
        'tasks',
      ]);
    } finally {
      await db.$client.end();
    }
  });
});
