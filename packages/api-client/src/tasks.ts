import {
  API_ROUTES,
  AppendTaskEventResponseSchema,
  CreateTaskResponseSchema,
  GetTaskResponseSchema,
  ListTasksResponseSchema,
  RecommendTaskResponseSchema,
  TaskMutationResponseSchema,
  UpdateTaskResponseSchema,
  type AppendTaskEventRequest,
  type AppendTaskEventResponse,
  type ApproveTaskRequest,
  type AssignTaskRequest,
  type BlockTaskRequest,
  type CancelTaskRequest,
  type CreateTaskRequest,
  type CreateTaskResponse,
  type FailTaskRequest,
  type GetTaskResponse,
  type ListTasksQuery,
  type ListTasksResponse,
  type RecommendTaskResponse,
  type RejectTaskRequest,
  type ResumeTaskRequest,
  type SubmitTaskRequest,
  type TaskCommandRequest,
  type TaskMutationResponse,
  type UpdateTaskRequest,
  type UpdateTaskResponse,
} from '@logact-pub/opc-protocol';
import type { OpcHttpClient } from './http.js';

const API_PREFIX = '/api/v1';
const route = (path: string): string => path.replace(API_PREFIX, '');
const taskRoute = (factory: (id: string) => string, id: string): string =>
  route(factory(encodeURIComponent(id)));

export function createTasksApi(client: OpcHttpClient) {
  const command = async (
    path: string,
    payload:
      | AssignTaskRequest
      | TaskCommandRequest
      | BlockTaskRequest
      | SubmitTaskRequest
      | ApproveTaskRequest
      | RejectTaskRequest
      | FailTaskRequest
  ): Promise<TaskMutationResponse> =>
    TaskMutationResponseSchema.parse(await client.post<unknown>(path, payload));

  return {
    create: async (payload: CreateTaskRequest): Promise<CreateTaskResponse> =>
      CreateTaskResponseSchema.parse(
        await client.post<unknown>(route(API_ROUTES.tasks), payload)
      ),

    list: async (query: Partial<ListTasksQuery> = {}): Promise<ListTasksResponse> => {
      const params = new URLSearchParams();
      if (query.status) params.set('status', query.status);
      if (query.departmentId) params.set('departmentId', query.departmentId);
      if (query.creatorId) params.set('creatorId', query.creatorId);
      if (query.assigneeId) params.set('assigneeId', query.assigneeId);
      if (query.reviewerId) params.set('reviewerId', query.reviewerId);
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return ListTasksResponseSchema.parse(
        await client.get<unknown>(`${route(API_ROUTES.tasks)}${suffix}`)
      );
    },

    get: async (id: string): Promise<GetTaskResponse> =>
      GetTaskResponseSchema.parse(
        await client.get<unknown>(taskRoute(API_ROUTES.task, id))
      ),

    update: async (id: string, payload: UpdateTaskRequest): Promise<UpdateTaskResponse> =>
      UpdateTaskResponseSchema.parse(
        await client.patch<unknown>(taskRoute(API_ROUTES.task, id), payload)
      ),

    recommend: async (id: string): Promise<RecommendTaskResponse> =>
      RecommendTaskResponseSchema.parse(
        await client.post<unknown>(taskRoute(API_ROUTES.taskRecommendations, id))
      ),

    assign: async (id: string, payload: AssignTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskAssignments, id), payload),

    start: async (id: string, payload: TaskCommandRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskStart, id), payload),

    block: async (id: string, payload: BlockTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskBlock, id), payload),

    resume: async (id: string, payload: ResumeTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskResume, id), payload),

    submit: async (id: string, payload: SubmitTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskSubmit, id), payload),

    approve: async (id: string, payload: ApproveTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskApprove, id), payload),

    reject: async (id: string, payload: RejectTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskReject, id), payload),

    fail: async (id: string, payload: FailTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskFail, id), payload),

    cancel: async (id: string, payload: CancelTaskRequest): Promise<TaskMutationResponse> =>
      command(taskRoute(API_ROUTES.taskCancel, id), payload),

    appendEvent: async (
      id: string,
      payload: AppendTaskEventRequest
    ): Promise<AppendTaskEventResponse> =>
      AppendTaskEventResponseSchema.parse(
        await client.post<unknown>(taskRoute(API_ROUTES.taskEvents, id), payload)
      ),
  };
}
