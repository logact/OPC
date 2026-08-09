import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  API_ROUTES,
  AppendTaskEventRequestSchema,
  AppendTaskEventResponseSchema,
  AssignTaskRequestSchema,
  BlockTaskRequestSchema,
  CancelTaskRequestSchema,
  CreateTaskRequestSchema,
  CreateTaskResponseSchema,
  DecomposeTaskRequestSchema,
  DecomposeTaskResponseSchema,
  FailTaskRequestSchema,
  GetTaskResponseSchema,
  ListTasksQuerySchema,
  ListTasksResponseSchema,
  ResumeTaskRequestSchema,
  SubmitTaskRequestSchema,
  TaskCommandRequestSchema,
  TaskErrorResponseSchema,
  TaskIdParamSchema,
  TaskMutationResponseSchema,
  UpdateTaskRequestSchema,
  UpdateTaskResponseSchema,
} from '@logact-pub/opc-protocol';
import { TaskRepositoryError } from '@opc/database';
import type { ServerEnv } from './authorization.js';
import { TaskServiceError, type TaskService } from './task-service.js';

const taskErrorResponses = {
  400: {
    content: { 'application/json': { schema: TaskErrorResponseSchema } },
    description: 'Invalid task request',
  },
  403: {
    content: { 'application/json': { schema: TaskErrorResponseSchema } },
    description: 'Task actor is not permitted for this role',
  },
  404: {
    content: { 'application/json': { schema: TaskErrorResponseSchema } },
    description: 'Task not found or not visible',
  },
  409: {
    content: { 'application/json': { schema: TaskErrorResponseSchema } },
    description: 'Task state or idempotency conflict',
  },
  422: {
    content: { 'application/json': { schema: TaskErrorResponseSchema } },
    description: 'Invalid task participant or assignment',
  },
} as const;

export function respondTaskError(c: Context, error: unknown) {
  if (!(error instanceof TaskServiceError) && !(error instanceof TaskRepositoryError)) {
    throw error;
  }
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };
  if (error.status === 403) return c.json(body, 403);
  if (error.status === 404) return c.json(body, 404);
  if (error.status === 409) return c.json(body, 409);
  return c.json(body, 422);
}

export function registerTaskRoutes(
  app: OpenAPIHono<ServerEnv>,
  service: TaskService
): void {
  const actor = (c: Context<ServerEnv>) => c.get('actorId')!;

  const createTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.tasks,
    request: {
      body: { content: { 'application/json': { schema: CreateTaskRequestSchema } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: CreateTaskResponseSchema } },
        description: 'Task created (draft, or assigned when assigneeId is given)',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(createTaskRoute, async (c) => {
    try {
      return c.json(await service.create(actor(c), c.req.valid('json')), 201);
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const decomposeTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskDecompose('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: DecomposeTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: DecomposeTaskResponseSchema } },
        description: 'Task decomposed into independently-managed subtasks',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(decomposeTaskRoute, async (c) => {
    try {
      return c.json(
        await service.decompose(actor(c), c.req.valid('param').id, c.req.valid('json')),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const listTasksRoute = createRoute({
    method: 'get',
    path: API_ROUTES.tasks,
    request: { query: ListTasksQuerySchema },
    responses: {
      200: {
        content: { 'application/json': { schema: ListTasksResponseSchema } },
        description: 'Visibility-filtered tasks',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(listTasksRoute, async (c) => {
    try {
      return c.json(await service.list(actor(c), c.req.valid('query')), 200);
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const getTaskRoute = createRoute({
    method: 'get',
    path: API_ROUTES.task('{id}'),
    request: { params: TaskIdParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: GetTaskResponseSchema } },
        description: 'Task detail and immutable history',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(getTaskRoute, async (c) => {
    try {
      return c.json(await service.get(actor(c), c.req.valid('param').id), 200);
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const updateTaskRoute = createRoute({
    method: 'patch',
    path: API_ROUTES.task('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: UpdateTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: UpdateTaskResponseSchema } },
        description: 'Updated task draft',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(updateTaskRoute, async (c) => {
    try {
      return c.json(
        await service.update(actor(c), c.req.valid('param').id, c.req.valid('json')),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const assignTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskAssignments('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: AssignTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskMutationResponseSchema } },
        description: 'Assigned or reassigned task',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(assignTaskRoute, async (c) => {
    try {
      return c.json(
        await service.assign(actor(c), c.req.valid('param').id, c.req.valid('json')),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const startTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskStart('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: TaskCommandRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskMutationResponseSchema } },
        description: 'Task started',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(startTaskRoute, async (c) => {
    try {
      return c.json(
        await service.transition(
          actor(c),
          c.req.valid('param').id,
          { command: 'start', payload: c.req.valid('json') }
        ),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const blockTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskBlock('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: BlockTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskMutationResponseSchema } },
        description: 'Task blocked',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(blockTaskRoute, async (c) => {
    try {
      return c.json(
        await service.transition(
          actor(c),
          c.req.valid('param').id,
          { command: 'block', payload: c.req.valid('json') }
        ),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const resumeTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskResume('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: ResumeTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskMutationResponseSchema } },
        description: 'Task resumed',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(resumeTaskRoute, async (c) => {
    try {
      return c.json(
        await service.transition(
          actor(c),
          c.req.valid('param').id,
          { command: 'resume', payload: c.req.valid('json') }
        ),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const submitTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskSubmit('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: SubmitTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskMutationResponseSchema } },
        description: 'Task submitted and completed',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(submitTaskRoute, async (c) => {
    try {
      return c.json(
        await service.transition(
          actor(c),
          c.req.valid('param').id,
          { command: 'submit', payload: c.req.valid('json') }
        ),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const failTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskFail('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: FailTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskMutationResponseSchema } },
        description: 'Task failed',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(failTaskRoute, async (c) => {
    try {
      return c.json(
        await service.transition(
          actor(c),
          c.req.valid('param').id,
          { command: 'fail', payload: c.req.valid('json') }
        ),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const cancelTaskRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskCancel('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: CancelTaskRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskMutationResponseSchema } },
        description: 'Task cancelled',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(cancelTaskRoute, async (c) => {
    try {
      return c.json(
        await service.transition(
          actor(c),
          c.req.valid('param').id,
          { command: 'cancel', payload: c.req.valid('json') }
        ),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  const appendTaskEventRoute = createRoute({
    method: 'post',
    path: API_ROUTES.taskEvents('{id}'),
    request: {
      params: TaskIdParamSchema,
      body: { content: { 'application/json': { schema: AppendTaskEventRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: AppendTaskEventResponseSchema } },
        description: 'Task key event appended',
      },
      400: taskErrorResponses[400],
      403: taskErrorResponses[403],
      404: taskErrorResponses[404],
      409: taskErrorResponses[409],
      422: taskErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Tasks'],
  });
  app.openapi(appendTaskEventRoute, async (c) => {
    try {
      return c.json(
        await service.appendEvent(actor(c), c.req.valid('param').id, c.req.valid('json')),
        200
      );
    } catch (error) {
      return respondTaskError(c, error);
    }
  });

  // issue #130 兼容层：recommend / approve / reject 路由已从 API_ROUTES 移除，
  // 旧客户端调用时返回 410 Gone 并指向迁移路径（直接 assign / submit 即完成）。
  // 这些 literal 路径是唯一的例外（路由已不在 protocol 中），下一个 major 移除。
  const goneMessage =
    'This route was removed in the simplified task center (issue #130): ' +
    'recommendation and review no longer exist. Migrate to direct assignment ' +
    '(POST /api/v1/tasks/:id/assignments) and submit, which completes the task immediately.';
  for (const removed of ['recommendations', 'approve', 'reject']) {
    app.post(`/api/v1/tasks/:id/${removed}`, (c) =>
      c.json({ error: { code: 'route_removed', message: goneMessage } }, 410)
    );
  }
}
