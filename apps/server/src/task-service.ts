import type {
  AppendTaskEventRequest,
  AppendTaskEventResponse,
  AssignTaskRequest,
  BlockTaskRequest,
  CancelTaskRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  FailTaskRequest,
  GetTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  ResumeTaskRequest,
  ServerEvent,
  SubmitTaskRequest,
  Task,
  TaskErrorCode,
  TaskEvent,
  TaskMutationResponse,
  UpdateTaskRequest,
  UpdateTaskResponse,
} from '@logact-pub/opc-protocol';
import type { ParticipantRepository, TaskRepository } from '@opc/database';

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
  | { command: 'fail'; payload: FailTaskRequest }
  | { command: 'cancel'; payload: CancelTaskRequest };

/**
 * issue #130：任务授权是角色制（creator / 当前 assignee / 任务房间成员），
 * 不再经过 department-scoped capability。违规一律 403 forbidden。
 */
export function createTaskService({
  taskRepository,
  participantRepository,
  publish,
}: {
  taskRepository: TaskRepository;
  participantRepository: ParticipantRepository;
  publish?: (roomId: string, event: ServerEvent) => void;
}) {
  async function requireTask(taskId: string): Promise<Task> {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new TaskServiceError('task_not_found', 404, `task ${taskId} not found`);
    }
    return task;
  }

  function forbidden(message: string): never {
    throw new TaskServiceError('forbidden', 403, message);
  }

  async function requireHumanActor(actorId: string): Promise<void> {
    const actor = await participantRepository.findById(actorId);
    if (actor?.kind !== 'human') {
      throw new TaskServiceError(
        'human_confirmation_required',
        403,
        'task assignment requires a human actor'
      );
    }
  }

  async function validateAssignee(assigneeId: string): Promise<void> {
    const assignee = await participantRepository.findById(assigneeId);
    if (!assignee || assignee.kind === 'gateway') {
      throw new TaskServiceError(
        'invalid_task_participant',
        422,
        `assignee ${assigneeId} must be an existing human or agent participant`,
        { participantId: assigneeId }
      );
    }
  }

  function requireCreator(actorId: string, task: Task): void {
    if (task.creatorId !== actorId) {
      forbidden('only the task creator may perform this operation');
    }
  }

  function requireCurrentAssignee(actorId: string, task: Task): void {
    if (task.assigneeId !== actorId) {
      forbidden('only the current task assignee may perform this transition');
    }
  }

  /** 读可见性：creator、当前 assignee，或任务房间成员；其他人视同不存在。 */
  async function canRead(actorId: string, task: Task): Promise<boolean> {
    if (task.creatorId === actorId || task.assigneeId === actorId) return true;
    if (!task.roomId) return false;
    return taskRepository.isRoomMember(task.roomId, actorId);
  }

  async function requireRead(actorId: string, task: Task): Promise<void> {
    if (!(await canRead(actorId, task))) {
      throw new TaskServiceError('task_not_found', 404, `task ${task.id} not found`);
    }
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

  function publishDispatch(message: ServerEvent & { type: 'message.delivered' }): void {
    if (!publish) return;
    publish(message.message.roomId, message);
  }

  return {
    async create(actorId: string, input: CreateTaskRequest): Promise<CreateTaskResponse> {
      if (!input.assigneeId) {
        // 任何已认证 participant（含 agent / gateway）都可以创建 draft
        return taskRepository.create(actorId, input);
      }
      // 创建即指派属于 assignment 语义：只能由 human 发起
      await requireHumanActor(actorId);
      await validateAssignee(input.assigneeId);
      const outcome = await taskRepository.createAssigned(actorId, {
        ...input,
        assigneeId: input.assigneeId,
      });
      if (outcome.message) {
        publishDispatch({ type: 'message.delivered', message: outcome.message });
      }
      publishEvent(outcome.response.task, outcome.event);
      return outcome.response;
    },

    async list(actorId: string, query: ListTasksQuery): Promise<ListTasksResponse> {
      const result = await taskRepository.list(query);
      const visible: Task[] = [];
      for (const task of result.tasks) {
        if (await canRead(actorId, task)) visible.push(task);
      }
      return {
        tasks: visible,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    },

    async get(actorId: string, taskId: string): Promise<GetTaskResponse> {
      const task = await requireTask(taskId);
      await requireRead(actorId, task);
      return taskRepository.getDetail(taskId);
    },

    async update(
      actorId: string,
      taskId: string,
      input: UpdateTaskRequest
    ): Promise<UpdateTaskResponse> {
      const task = await requireTask(taskId);
      requireCreator(actorId, task);
      const updated = await taskRepository.updateDraft(taskId, actorId, input);
      publishEvent(updated.task, updated.event);
      return { task: updated.task };
    },

    async assign(
      actorId: string,
      taskId: string,
      input: AssignTaskRequest
    ): Promise<TaskMutationResponse> {
      const task = await requireTask(taskId);
      requireCreator(actorId, task);
      await requireHumanActor(actorId);
      await validateAssignee(input.assigneeId);
      const outcome = await taskRepository.assign(taskId, actorId, input);
      if (outcome.message && !outcome.replayed) {
        publishDispatch({ type: 'message.delivered', message: outcome.message });
      }
      publishEvent(outcome.response.task, outcome.event, outcome.replayed);
      return outcome.response;
    },

    async transition(
      actorId: string,
      taskId: string,
      input: TransitionInput,
    ): Promise<TaskMutationResponse> {
      const task = await requireTask(taskId);
      const assignmentId =
        'assignmentId' in input.payload ? input.payload.assignmentId : undefined;
      if (assignmentId) {
        const detail = await taskRepository.getDetail(taskId);
        const currentAssignment = detail.assignments.find(
          (assignment) => assignment.supersededAt === null,
        );
        if (currentAssignment?.id !== assignmentId) {
          throw new TaskServiceError(
            'stale_task_assignment',
            409,
            `assignment ${assignmentId} is no longer current`,
            {
              taskId,
              assignmentId,
              currentAssignmentId: currentAssignment?.id,
            },
          );
        }
      }
      if (input.command === 'cancel') {
        requireCreator(actorId, task);
      } else {
        requireCurrentAssignee(actorId, task);
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
      if (!(await canRead(actorId, task))) {
        forbidden('only the task creator, assignee, or task-room members may record events');
      }
      const outcome = await taskRepository.appendEvent(taskId, actorId, input);
      publishEvent(outcome.response.task, outcome.event, outcome.replayed);
      return outcome.response;
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
