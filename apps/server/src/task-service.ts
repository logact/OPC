import type {
  AppendTaskEventRequest,
  AddTaskDependencyRequest,
  AppendTaskEventResponse,
  AssignTaskRequest,
  BlockTaskRequest,
  CancelTaskRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  DecomposeTaskRequest,
  DecomposeTaskResponse,
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
import type { OrganizationRepository, ParticipantRepository, TaskRepository } from '@opc/database';

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
  organizationRepository,
  publish,
}: {
  taskRepository: TaskRepository;
  participantRepository: ParticipantRepository;
  organizationRepository: OrganizationRepository;
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

  /**
   * A department leader may delegate work currently assigned to them to an
   * active staff member in that department or one of its descendants. Tasks
   * intentionally do not carry a department after #130, so the leader's
   * active assignment provides the routing scope for this operation.
   */
  async function canDelegateToDepartmentStaff(leaderId: string, staffId: string): Promise<boolean> {
    if (leaderId === staffId) return false;
    try {
      const [leader, staff, departments] = await Promise.all([
        organizationRepository.getStaff(leaderId),
        organizationRepository.getStaff(staffId),
        organizationRepository.listDepartments(),
      ]);
      const parentById = new Map(departments.map((department) => [department.id, department.parentId]));
      const isWithinLeaderDepartment = (leaderDepartmentId: string, staffDepartmentId: string) => {
        let cursor: string | null | undefined = staffDepartmentId;
        const visited = new Set<string>();
        while (cursor && !visited.has(cursor)) {
          if (cursor === leaderDepartmentId) return true;
          visited.add(cursor);
          cursor = parentById.get(cursor);
        }
        return false;
      };
      return leader.assignments.some(
        (leaderAssignment) =>
          leaderAssignment.active &&
          leaderAssignment.isDepartmentLeader &&
          staff.assignments.some(
            (staffAssignment) =>
              staffAssignment.active &&
              isWithinLeaderDepartment(leaderAssignment.departmentId, staffAssignment.departmentId)
          )
      );
    } catch {
      // Missing/non-staff participants are never valid department delegates.
      return false;
    }
  }

  async function requireAssigner(actorId: string, task: Task, assigneeId: string): Promise<void> {
    if (task.creatorId === actorId) return;
    if (task.assigneeId !== actorId) {
      forbidden('only the task creator or current department-leader assignee may assign this task');
    }
    if (!(await canDelegateToDepartmentStaff(actorId, assigneeId))) {
      forbidden('a department leader may assign only to active staff in their department subtree');
    }
  }

  function requireCurrentAssignee(actorId: string, task: Task): void {
    if (task.assigneeId !== actorId) {
      forbidden('only the current task assignee may perform this transition');
    }
  }

  /** Both the creator and accountable assignee may split work into children. */
  function requireDecomposer(actorId: string, task: Task): void {
    if (task.creatorId !== actorId && task.assigneeId !== actorId) {
      forbidden('only the task creator or current assignee may decompose this task');
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

  function publishRelatedEvents(
    relatedEvents: Array<{ task: Task; event: TaskEvent }> | undefined,
    replayed = false
  ): void {
    for (const related of relatedEvents ?? []) {
      publishEvent(related.task, related.event, replayed);
    }
  }

  return {
    async create(actorId: string, input: CreateTaskRequest): Promise<CreateTaskResponse> {
      if (input.parentTaskId) {
        if (input.originRoomId) {
          throw new TaskServiceError(
            'validation_error',
            422,
            'originRoomId cannot be used when creating a subtask'
          );
        }
        const parent = await requireTask(input.parentTaskId);
        requireDecomposer(actorId, parent);
        if (input.assigneeId) await validateAssignee(input.assigneeId);
        const outcome = await taskRepository.createChild(parent.id, actorId, input);
        if (outcome.message) {
          publishDispatch({ type: 'message.delivered', message: outcome.message });
        }
        publishEvent(outcome.response.task, outcome.event);
        publishEvent(outcome.parentTask, outcome.parentEvent);
        return outcome.response;
      }
      if (!input.assigneeId) {
        if (input.originRoomId) {
          // issue #129：任务卡片依附于创建即指派，draft 任务不支持 originRoomId
          throw new TaskServiceError(
            'validation_error',
            422,
            'originRoomId requires assigneeId (create-with-assignee)'
          );
        }
        // 任何已认证 participant（含 agent / gateway）都可以创建 draft
        return taskRepository.create(actorId, input);
      }
      // 创建即指派属于 assignment 语义：只能由 human 发起
      await requireHumanActor(actorId);
      await validateAssignee(input.assigneeId);
      if (input.originRoomId) {
        // 任务卡片发回发起房间：creator 与 assignee 都必须是该房间成员，
        // 防止借 originRoomId 往无关房间写入消息
        if (!(await taskRepository.isRoomMember(input.originRoomId, actorId))) {
          forbidden('creator is not a member of the origin room');
        }
        if (!(await taskRepository.isRoomMember(input.originRoomId, input.assigneeId))) {
          throw new TaskServiceError(
            'invalid_task_participant',
            422,
            `assignee ${input.assigneeId} is not a member of the origin room`,
            { participantId: input.assigneeId, originRoomId: input.originRoomId }
          );
        }
      }
      const outcome = await taskRepository.createAssigned(actorId, {
        ...input,
        assigneeId: input.assigneeId,
      });
      if (outcome.message) {
        publishDispatch({ type: 'message.delivered', message: outcome.message });
      }
      if (outcome.originMessage) {
        publishDispatch({ type: 'message.delivered', message: outcome.originMessage });
      }
      publishEvent(outcome.response.task, outcome.event);
      return outcome.response;
    },

    async decompose(
      actorId: string,
      taskId: string,
      input: DecomposeTaskRequest
    ): Promise<DecomposeTaskResponse> {
      const task = await requireTask(taskId);
      requireDecomposer(actorId, task);
      await Promise.all(
        input.subtasks.flatMap((subtask) =>
          subtask.assigneeId ? [validateAssignee(subtask.assigneeId)] : []
        )
      );
      const outcome = await taskRepository.decompose(taskId, actorId, input);
      for (const message of outcome.relatedMessages ?? []) {
        if (!outcome.replayed) publishDispatch({ type: 'message.delivered', message });
      }
      publishEvent(outcome.response.task, outcome.event, outcome.replayed);
      publishRelatedEvents(outcome.relatedEvents, outcome.replayed);
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
      await requireHumanActor(actorId);
      await validateAssignee(input.assigneeId);
      await requireAssigner(actorId, task, input.assigneeId);
      const outcome = await taskRepository.assign(taskId, actorId, input);
      if (outcome.message && !outcome.replayed) {
        publishDispatch({ type: 'message.delivered', message: outcome.message });
      }
      publishEvent(outcome.response.task, outcome.event, outcome.replayed);
      return outcome.response;
    },

    async addDependency(actorId: string, taskId: string, input: AddTaskDependencyRequest) {
      const task = await requireTask(taskId);
      requireCreator(actorId, task);
      const outcome = await taskRepository.addDependency(taskId, actorId, input);
      publishEvent(task, outcome.event);
      return { dependency: outcome.dependency };
    },

    async removeDependency(actorId: string, taskId: string, dependsOnTaskId: string) {
      const task = await requireTask(taskId);
      requireCreator(actorId, task);
      const outcome = await taskRepository.removeDependency(taskId, dependsOnTaskId, actorId);
      publishEvent(task, outcome.event);
      return { dependency: outcome.dependency };
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
      publishRelatedEvents(outcome.relatedEvents, outcome.replayed);
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
