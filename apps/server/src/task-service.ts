import type {
  AppendTaskEventRequest,
  AppendTaskEventResponse,
  ApproveTaskRequest,
  AssignTaskRequest,
  AuthorizationResource,
  BlockTaskRequest,
  CancelTaskRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  FailTaskRequest,
  GetTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  RecommendTaskResponse,
  RejectTaskRequest,
  ResumeTaskRequest,
  ServerEvent,
  SubmitTaskRequest,
  Task,
  TaskErrorCode,
  TaskEvent,
  TaskMutationResponse,
  TaskTarget,
  UpdateTaskRequest,
  UpdateTaskResponse,
} from '@logact-pub/opc-protocol';
import type {
  OrganizationRepository,
  ParticipantRepository,
  TaskRepository,
} from '@opc/database';
import { AuthorizationDeniedError, type AuthorizationService } from './authorization.js';

export class TaskServiceError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    readonly status: 403 | 404 | 409 | 422,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TaskServiceError';
  }
}

type TransitionInput =
  | { command: 'start'; payload: { idempotencyKey: string } }
  | { command: 'block'; payload: BlockTaskRequest }
  | { command: 'resume'; payload: ResumeTaskRequest }
  | { command: 'submit'; payload: SubmitTaskRequest }
  | { command: 'approve'; payload: ApproveTaskRequest }
  | { command: 'reject'; payload: RejectTaskRequest }
  | { command: 'fail'; payload: FailTaskRequest }
  | { command: 'cancel'; payload: CancelTaskRequest };

function taskResource(task: Task): AuthorizationResource {
  return {
    type: 'task',
    id: task.id,
    departmentId: task.departmentId,
    creatorId: task.creatorId,
    assigneeId: task.assigneeId ?? undefined,
    collaboratorIds: task.collaboratorIds,
    reviewerIds: task.reviewerId ? [task.reviewerId] : [],
  };
}

export function createTaskService({
  taskRepository,
  organizationRepository,
  participantRepository,
  authorization,
  publish,
}: {
  taskRepository: TaskRepository;
  organizationRepository: OrganizationRepository;
  participantRepository: ParticipantRepository;
  authorization: AuthorizationService;
  publish?: (roomId: string, event: ServerEvent) => void;
}) {
  async function requireTask(taskId: string): Promise<Task> {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new TaskServiceError('task_not_found', 404, `task ${taskId} not found`);
    }
    return task;
  }

  async function validateTarget(departmentId: string, target?: TaskTarget | null): Promise<void> {
    try {
      await organizationRepository.getDepartment(departmentId);
    } catch {
      throw new TaskServiceError(
        'invalid_task_target',
        422,
        `task department ${departmentId} does not exist`
      );
    }
    if (!target) return;

    if (target.type === 'position') {
      try {
        const position = await organizationRepository.getPosition(target.positionId);
        if (!(await taskRepository.departmentIsWithin(departmentId, position.departmentId))) {
          throw new Error('outside task department');
        }
      } catch {
        throw new TaskServiceError(
          'invalid_task_target',
          422,
          `position ${target.positionId} is not inside the task department`
        );
      }
      return;
    }

    if (target.type === 'department') {
      try {
        await organizationRepository.getDepartment(target.departmentId);
        if (!(await taskRepository.departmentIsWithin(departmentId, target.departmentId))) {
          throw new Error('outside task department');
        }
      } catch {
        throw new TaskServiceError(
          'invalid_task_target',
          422,
          `department ${target.departmentId} is not inside the task department`
        );
      }
      return;
    }

    const participant = await participantRepository.findById(target.participantId);
    if (!participant || participant.kind === 'gateway') {
      throw new TaskServiceError(
        'invalid_task_target',
        422,
        `participant ${target.participantId} is not task-assignable staff`
      );
    }
    try {
      const staff = await organizationRepository.getStaff(target.participantId);
      const inside = await Promise.all(
        staff.assignments
          .filter((assignment) => assignment.active)
          .map((assignment) =>
            taskRepository.departmentIsWithin(departmentId, assignment.departmentId)
          )
      );
      if (!inside.some(Boolean)) throw new Error('outside task department');
    } catch {
      throw new TaskServiceError(
        'invalid_task_target',
        422,
        `participant ${target.participantId} is not active in the task department`
      );
    }
  }

  async function validateTaskParticipant(
    participantId: string,
    departmentId: string,
    role: 'assignee' | 'collaborator' | 'reviewer'
  ): Promise<void> {
    const participant = await participantRepository.findById(participantId);
    if (
      !participant ||
      participant.kind === 'gateway' ||
      (role === 'reviewer' && participant.kind !== 'human')
    ) {
      throw new TaskServiceError(
        'invalid_task_participant',
        422,
        `${role} ${participantId} is not valid task staff`,
        { participantId, role }
      );
    }
    try {
      const staff = await organizationRepository.getStaff(participantId);
      const inside = await Promise.all(
        staff.assignments
          .filter((assignment) => assignment.active)
          .map((assignment) =>
            taskRepository.departmentIsWithin(departmentId, assignment.departmentId)
          )
      );
      if (!inside.some(Boolean)) throw new Error('outside task department');
    } catch {
      throw new TaskServiceError(
        'invalid_task_participant',
        422,
        `${role} ${participantId} is not active in the task department`,
        { participantId, role, departmentId }
      );
    }
  }

  async function directParticipantIds(taskId: string): Promise<Set<string>> {
    const detail = await taskRepository.getDetail(taskId);
    return new Set([
      detail.task.creatorId,
      ...detail.assignments.flatMap((assignment) => [
        assignment.assigneeId,
        assignment.reviewerId,
        ...assignment.collaboratorIds,
      ]),
      ...(detail.task.assigneeId ? [detail.task.assigneeId] : []),
      ...(detail.task.reviewerId ? [detail.task.reviewerId] : []),
      ...detail.task.collaboratorIds,
    ]);
  }

  async function authorizeRead(actorId: string, task: Task): Promise<boolean> {
    const resource = taskResource(task);
    if ((await directParticipantIds(task.id)).has(actorId)) {
      await authorization.allow(actorId, 'task.read', resource, 'direct task participant');
      return true;
    }
    const read = await authorization.evaluate(actorId, 'task.read', resource);
    if (read.allowed) {
      await authorization.allow(actorId, 'task.read', resource, read.reason);
      return true;
    }
    const manage = await authorization.evaluate(actorId, 'task.manage', resource);
    if (manage.allowed) {
      await authorization.allow(actorId, 'task.read', resource, 'task.manage covers task read');
      return true;
    }
    await authorization.deny(actorId, 'task.read', resource, 'task is outside actor visibility');
    return false;
  }

  function publishEvent(task: Task, event?: TaskEvent, replayed = false): void {
    if (!publish || !event || replayed || !task.roomId) return;
    publish(task.roomId, {
      type: 'task.event',
      roomId: task.roomId,
      taskId: task.id,
      event,
    });
  }

  async function requireExplicitRole(
    actorId: string,
    task: Task,
    role: 'assignee' | 'reviewer'
  ): Promise<void> {
    const expected = role === 'assignee' ? task.assigneeId : task.reviewerId;
    const action = role === 'reviewer' ? 'task.review' : 'task.manage';
    if (actorId !== expected) {
      const decision = await authorization.deny(
        actorId,
        action,
        taskResource(task),
        `only the current task ${role} may perform this transition`
      );
      throw new AuthorizationDeniedError(decision);
    }
    if (role === 'reviewer') {
      await authorization.require(actorId, 'task.review', taskResource(task));
    } else {
      await authorization.allow(
        actorId,
        'task.manage',
        taskResource(task),
        'current accountable task assignee'
      );
    }
  }

  return {
    async create(actorId: string, input: CreateTaskRequest): Promise<CreateTaskResponse> {
      await validateTarget(input.departmentId, input.target);
      await authorization.require(actorId, 'task.create', {
        type: 'task',
        id: 'new',
        departmentId: input.departmentId,
        creatorId: actorId,
        collaboratorIds: [],
        reviewerIds: [],
      });
      return taskRepository.create(actorId, input);
    },

    async list(actorId: string, query: ListTasksQuery): Promise<ListTasksResponse> {
      const result = await taskRepository.list(query);
      const visible: Task[] = [];
      for (const task of result.tasks) {
        if (await authorizeRead(actorId, task)) visible.push(task);
      }
      return {
        tasks: visible,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    },

    async get(actorId: string, taskId: string): Promise<GetTaskResponse> {
      const task = await requireTask(taskId);
      if (!(await authorizeRead(actorId, task))) {
        throw new TaskServiceError('task_not_found', 404, `task ${taskId} not found`);
      }
      return taskRepository.getDetail(taskId);
    },

    async update(
      actorId: string,
      taskId: string,
      input: UpdateTaskRequest
    ): Promise<UpdateTaskResponse> {
      const task = await requireTask(taskId);
      if (task.creatorId === actorId) {
        await authorization.allow(
          actorId,
          'task.manage',
          taskResource(task),
          'task creator may edit draft'
        );
      } else {
        await authorization.require(actorId, 'task.manage', taskResource(task));
      }
      if (input.target !== undefined) await validateTarget(task.departmentId, input.target);
      const updated = await taskRepository.updateDraft(taskId, actorId, input);
      publishEvent(updated.task, updated.event);
      return { task: updated.task };
    },

    async recommend(actorId: string, taskId: string): Promise<RecommendTaskResponse> {
      const task = await requireTask(taskId);
      const actor = await participantRepository.findById(actorId);
      if (actor?.kind !== 'human') {
        throw new TaskServiceError(
          'human_confirmation_required',
          403,
          'task recommendation and assignment require a human actor'
        );
      }
      await authorization.require(actorId, 'task.assign', taskResource(task));
      return { recommendations: await taskRepository.recommend(taskId) };
    },

    async assign(
      actorId: string,
      taskId: string,
      input: AssignTaskRequest
    ): Promise<TaskMutationResponse> {
      const task = await requireTask(taskId);
      const actor = await participantRepository.findById(actorId);
      if (actor?.kind !== 'human') {
        throw new TaskServiceError(
          'human_confirmation_required',
          403,
          'final task assignment requires a human actor'
        );
      }
      await authorization.require(actorId, 'task.assign', taskResource(task));
      const collaborators = new Set(input.collaboratorIds);
      if (
        collaborators.size !== input.collaboratorIds.length ||
        collaborators.has(input.assigneeId) ||
        input.reviewerId === input.assigneeId ||
        collaborators.has(input.reviewerId)
      ) {
        throw new TaskServiceError(
          'invalid_task_roles',
          422,
          'assignee, collaborators, and reviewer must be unique by role'
        );
      }
      await validateTaskParticipant(input.assigneeId, task.departmentId, 'assignee');
      await validateTaskParticipant(input.reviewerId, task.departmentId, 'reviewer');
      await Promise.all(
        input.collaboratorIds.map((participantId) =>
          validateTaskParticipant(participantId, task.departmentId, 'collaborator')
        )
      );
      if (!(await taskRepository.isCandidateEligible(taskId, input.assigneeId))) {
        throw new TaskServiceError(
          'task_candidate_ineligible',
          422,
          `assignee ${input.assigneeId} no longer matches target and required skills`
        );
      }
      const outcome = await taskRepository.assign(taskId, actorId, input);
      publishEvent(outcome.response.task, outcome.event, outcome.replayed);
      return outcome.response;
    },

    async transition(
      actorId: string,
      taskId: string,
      input: TransitionInput
    ): Promise<TaskMutationResponse> {
      const task = await requireTask(taskId);
      if (input.command === 'approve' || input.command === 'reject') {
        await requireExplicitRole(actorId, task, 'reviewer');
      } else if (input.command === 'cancel') {
        if (task.creatorId === actorId) {
          await authorization.allow(
            actorId,
            'task.manage',
            taskResource(task),
            'task creator may cancel task'
          );
        } else {
          await authorization.require(actorId, 'task.manage', taskResource(task));
        }
      } else {
        await requireExplicitRole(actorId, task, 'assignee');
      }
      const outcome = await taskRepository.transition(taskId, actorId, input);
      publishEvent(outcome.response.task, outcome.event, outcome.replayed);
      return outcome.response;
    },

    async appendEvent(
      actorId: string,
      taskId: string,
      input: AppendTaskEventRequest
    ): Promise<AppendTaskEventResponse> {
      const task = await requireTask(taskId);
      if ((await directParticipantIds(taskId)).has(actorId)) {
        await authorization.allow(
          actorId,
          'task.manage',
          taskResource(task),
          'direct task participant may record key event'
        );
      } else {
        await authorization.require(actorId, 'task.manage', taskResource(task));
      }
      const outcome = await taskRepository.appendEvent(taskId, actorId, input);
      publishEvent(outcome.response.task, outcome.event, outcome.replayed);
      return outcome.response;
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
