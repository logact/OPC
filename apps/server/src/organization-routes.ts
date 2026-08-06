import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  API_ROUTES,
  CreateDepartmentRequestSchema,
  CreateDepartmentResponseSchema,
  CreatePositionRequestSchema,
  CreatePositionResponseSchema,
  CreateStaffAssignmentRequestSchema,
  CreateStaffAssignmentResponseSchema,
  DeleteDepartmentResponseSchema,
  DeletePositionResponseSchema,
  DeleteStaffAssignmentResponseSchema,
  GetDepartmentResponseSchema,
  GetOrganizationResponseSchema,
  GetOrganizationTreeResponseSchema,
  GetPositionResponseSchema,
  GetStaffResponseSchema,
  ListDepartmentsResponseSchema,
  ListPositionsQuerySchema,
  ListPositionsResponseSchema,
  ListStaffResponseSchema,
  OrganizationErrorResponseSchema,
  OrganizationResourceIdParamSchema,
  OrganizationStaffParamSchema,
  UpdateDepartmentRequestSchema,
  UpdateDepartmentResponseSchema,
  UpdateOrganizationRequestSchema,
  UpdateOrganizationResponseSchema,
  UpdatePositionRequestSchema,
  UpdatePositionResponseSchema,
  UpdateStaffAssignmentRequestSchema,
  UpdateStaffAssignmentResponseSchema,
} from '@logact-pub/opc-protocol';
import {
  OrganizationRepositoryError,
  type OrganizationRepository,
} from '@opc/database';
import type { AuthorizationResource } from '@logact-pub/opc-protocol';
import type { AuthorizationService, ServerEnv } from './authorization.js';

const organizationErrorResponses = {
  404: {
    content: { 'application/json': { schema: OrganizationErrorResponseSchema } },
    description: 'Organization resource not found',
  },
  409: {
    content: { 'application/json': { schema: OrganizationErrorResponseSchema } },
    description: 'Organization invariant conflict',
  },
  422: {
    content: { 'application/json': { schema: OrganizationErrorResponseSchema } },
    description: 'Invalid organization mutation',
  },
} as const;

export function respondOrganizationError(c: Context, error: unknown) {
  if (!(error instanceof OrganizationRepositoryError)) throw error;
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };
  if (error.status === 404) return c.json(body, 404);
  if (error.status === 409) return c.json(body, 409);
  return c.json(body, 422);
}

export function respondParticipantOrganizationError(c: Context, error: unknown) {
  if (!(error instanceof OrganizationRepositoryError) || error.status === 404) throw error;
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };
  if (error.status === 409) return c.json(body, 409);
  return c.json(body, 422);
}

export function registerOrganizationRoutes(
  app: OpenAPIHono<ServerEnv>,
  repository: OrganizationRepository,
  authorization: AuthorizationService
): void {
  const organizationResource: AuthorizationResource = {
    type: 'organization',
    id: 'default',
  };
  const actor = (c: Context<ServerEnv>) => c.get('actorId')!;
  const departmentResource = (id: string): AuthorizationResource => ({
    type: 'department',
    id,
    departmentId: id,
  });
  const positionResource = (id: string, departmentId: string): AuthorizationResource => ({
    type: 'position',
    id,
    departmentId,
  });
  const getOrganizationRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organization,
    responses: {
      200: {
        content: { 'application/json': { schema: GetOrganizationResponseSchema } },
        description: 'Deployment organization',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(getOrganizationRoute, async (c) => {
    try {
      await authorization.require(actor(c), 'organization.read', organizationResource);
      return c.json({ organization: await repository.getOrganization() }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const updateOrganizationRoute = createRoute({
    method: 'patch',
    path: API_ROUTES.organization,
    request: {
      body: { content: { 'application/json': { schema: UpdateOrganizationRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: UpdateOrganizationResponseSchema } },
        description: 'Updated organization',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(updateOrganizationRoute, async (c) => {
    try {
      const { name } = c.req.valid('json');
      await authorization.require(actor(c), 'organization.manage', organizationResource);
      return c.json({ organization: await repository.updateOrganization(name) }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const getTreeRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organizationTree,
    responses: {
      200: {
        content: { 'application/json': { schema: GetOrganizationTreeResponseSchema } },
        description: 'Organization department tree',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(getTreeRoute, async (c) => {
    try {
      await authorization.require(actor(c), 'organization.read', organizationResource);
      const [organization, departmentTree] = await Promise.all([
        repository.getOrganization(),
        repository.getTree(),
      ]);
      return c.json({ organization, departments: departmentTree }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const listDepartmentsRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organizationDepartments,
    responses: {
      200: {
        content: { 'application/json': { schema: ListDepartmentsResponseSchema } },
        description: 'Departments',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(listDepartmentsRoute, async (c) => {
    try {
      await authorization.require(actor(c), 'department.read', organizationResource);
      return c.json({ departments: await repository.listDepartments() }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const createDepartmentRoute = createRoute({
    method: 'post',
    path: API_ROUTES.organizationDepartments,
    request: {
      body: { content: { 'application/json': { schema: CreateDepartmentRequestSchema } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: CreateDepartmentResponseSchema } },
        description: 'Department created',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(createDepartmentRoute, async (c) => {
    try {
      const input = c.req.valid('json');
      const resource = input.parentId
        ? departmentResource(input.parentId)
        : organizationResource;
      await authorization.require(actor(c), 'department.manage', resource);
      const department = await repository.createDepartment(input);
      // Record the concrete resource id as well as the pre-create scope check.
      await authorization.require(actor(c), 'department.manage', departmentResource(department.id));
      return c.json({ department }, 201);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const getDepartmentRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organizationDepartment('{id}'),
    request: { params: OrganizationResourceIdParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: GetDepartmentResponseSchema } },
        description: 'Department',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(getDepartmentRoute, async (c) => {
    try {
      const id = c.req.valid('param').id;
      await authorization.require(actor(c), 'department.read', departmentResource(id));
      return c.json({ department: await repository.getDepartment(id) }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const updateDepartmentRoute = createRoute({
    method: 'patch',
    path: API_ROUTES.organizationDepartment('{id}'),
    request: {
      params: OrganizationResourceIdParamSchema,
      body: { content: { 'application/json': { schema: UpdateDepartmentRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: UpdateDepartmentResponseSchema } },
        description: 'Updated department',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(updateDepartmentRoute, async (c) => {
    try {
      return c.json(
        {
          department: await (async () => {
            const id = c.req.valid('param').id;
            const input = c.req.valid('json');
            await authorization.require(actor(c), 'department.manage', departmentResource(id));
            if (input.parentId) {
              await authorization.require(
                actor(c),
                'department.manage',
                departmentResource(input.parentId)
              );
            }
            return repository.updateDepartment(id, input);
          })(),
        },
        200
      );
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const deleteDepartmentRoute = createRoute({
    method: 'delete',
    path: API_ROUTES.organizationDepartment('{id}'),
    request: { params: OrganizationResourceIdParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: DeleteDepartmentResponseSchema } },
        description: 'Deleted department',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(deleteDepartmentRoute, async (c) => {
    try {
      const { id } = c.req.valid('param');
      await authorization.require(actor(c), 'department.manage', departmentResource(id));
      await repository.deleteDepartment(id);
      return c.json({ departmentId: id }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const listPositionsRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organizationPositions,
    request: { query: ListPositionsQuerySchema },
    responses: {
      200: {
        content: { 'application/json': { schema: ListPositionsResponseSchema } },
        description: 'Positions',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(listPositionsRoute, async (c) => {
    try {
      const departmentId = c.req.valid('query').departmentId;
      await authorization.require(
        actor(c),
        'position.read',
        departmentId ? departmentResource(departmentId) : organizationResource
      );
      return c.json(
        { positions: await repository.listPositions(departmentId) },
        200
      );
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const createPositionRoute = createRoute({
    method: 'post',
    path: API_ROUTES.organizationPositions,
    request: {
      body: { content: { 'application/json': { schema: CreatePositionRequestSchema } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: CreatePositionResponseSchema } },
        description: 'Position created',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(createPositionRoute, async (c) => {
    try {
      const input = c.req.valid('json');
      await authorization.require(
        actor(c),
        'position.manage',
        positionResource('new', input.departmentId)
      );
      await authorization.requireDelegation(
        actor(c),
        input.capabilityGrants ?? [],
        input.departmentId
      );
      return c.json({ position: await repository.createPosition(input) }, 201);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const getPositionRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organizationPosition('{id}'),
    request: { params: OrganizationResourceIdParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: GetPositionResponseSchema } },
        description: 'Position',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(getPositionRoute, async (c) => {
    try {
      const position = await repository.getPosition(c.req.valid('param').id);
      await authorization.require(
        actor(c),
        'position.read',
        positionResource(position.id, position.departmentId)
      );
      return c.json({ position }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const updatePositionRoute = createRoute({
    method: 'patch',
    path: API_ROUTES.organizationPosition('{id}'),
    request: {
      params: OrganizationResourceIdParamSchema,
      body: { content: { 'application/json': { schema: UpdatePositionRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: UpdatePositionResponseSchema } },
        description: 'Updated position',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(updatePositionRoute, async (c) => {
    try {
      const current = await repository.getPosition(c.req.valid('param').id);
      const input = c.req.valid('json');
      const departmentId = input.departmentId ?? current.departmentId;
      await authorization.require(
        actor(c),
        'position.manage',
        positionResource(current.id, current.departmentId)
      );
      if (input.capabilityGrants) {
        await authorization.requireDelegation(actor(c), input.capabilityGrants, departmentId);
      }
      return c.json(
        {
          position: await repository.updatePosition(
            c.req.valid('param').id,
            input
          ),
        },
        200
      );
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const deletePositionRoute = createRoute({
    method: 'delete',
    path: API_ROUTES.organizationPosition('{id}'),
    request: { params: OrganizationResourceIdParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: DeletePositionResponseSchema } },
        description: 'Deleted position',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(deletePositionRoute, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const position = await repository.getPosition(id);
      await authorization.require(
        actor(c),
        'position.manage',
        positionResource(id, position.departmentId)
      );
      await repository.deletePosition(id);
      return c.json({ positionId: id }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const listStaffRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organizationStaff,
    responses: {
      200: {
        content: { 'application/json': { schema: ListStaffResponseSchema } },
        description: 'Staff profiles',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(listStaffRoute, async (c) => {
    try {
      await authorization.require(actor(c), 'staff.read', organizationResource);
      return c.json({ staff: await repository.listStaff() }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const getStaffRoute = createRoute({
    method: 'get',
    path: API_ROUTES.organizationStaffMember('{participantId}'),
    request: { params: OrganizationStaffParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: GetStaffResponseSchema } },
        description: 'Staff profile',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(getStaffRoute, async (c) => {
    try {
      const participantId = c.req.valid('param').participantId;
      const staff = await repository.getStaff(participantId);
      await authorization.require(actor(c), 'staff.read', {
        type: 'staff',
        id: participantId,
        participantId,
        departmentIds: staff.assignments.filter((item) => item.active).map((item) => item.departmentId),
      });
      return c.json({ staff }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const createAssignmentRoute = createRoute({
    method: 'post',
    path: API_ROUTES.organizationStaffAssignments('{participantId}'),
    request: {
      params: OrganizationStaffParamSchema,
      body: { content: { 'application/json': { schema: CreateStaffAssignmentRequestSchema } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: CreateStaffAssignmentResponseSchema } },
        description: 'Assignment created',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(createAssignmentRoute, async (c) => {
    try {
      const participantId = c.req.valid('param').participantId;
      const input = c.req.valid('json');
      const [staff, position] = await Promise.all([
        repository.getStaff(participantId),
        repository.getPosition(input.positionId),
      ]);
      const targetDepartmentIds = staff.assignments
        .filter((item) => item.active)
        .map((item) => item.departmentId);
      if (!targetDepartmentIds.includes(position.departmentId)) {
        targetDepartmentIds.push(position.departmentId);
      }
      await authorization.require(actor(c), 'staff.manage', {
        type: 'staff',
        id: participantId,
        participantId,
        departmentIds: targetDepartmentIds,
      });
      await authorization.requireDelegation(
        actor(c),
        position.capabilityGrants,
        position.departmentId
      );
      return c.json(
        {
          assignment: await repository.createAssignment(
            participantId,
            input
          ),
        },
        201
      );
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const updateAssignmentRoute = createRoute({
    method: 'patch',
    path: API_ROUTES.organizationAssignment('{id}'),
    request: {
      params: OrganizationResourceIdParamSchema,
      body: { content: { 'application/json': { schema: UpdateStaffAssignmentRequestSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: UpdateStaffAssignmentResponseSchema } },
        description: 'Updated assignment',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(updateAssignmentRoute, async (c) => {
    try {
      const current = await repository.getAssignment(c.req.valid('param').id);
      await authorization.require(actor(c), 'staff.manage', {
        type: 'staff',
        id: current.staffParticipantId,
        participantId: current.staffParticipantId,
        departmentIds: [current.departmentId],
      });
      return c.json(
        {
          assignment: await repository.updateAssignment(
            c.req.valid('param').id,
            c.req.valid('json')
          ),
        },
        200
      );
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });

  const deleteAssignmentRoute = createRoute({
    method: 'delete',
    path: API_ROUTES.organizationAssignment('{id}'),
    request: { params: OrganizationResourceIdParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: DeleteStaffAssignmentResponseSchema } },
        description: 'Deleted assignment',
      },
      404: organizationErrorResponses[404],
      409: organizationErrorResponses[409],
      422: organizationErrorResponses[422],
    },
    security: [{ bearerAuth: [] }],
    tags: ['Organization'],
  });
  app.openapi(deleteAssignmentRoute, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const current = await repository.getAssignment(id);
      await authorization.require(actor(c), 'staff.manage', {
        type: 'staff',
        id: current.staffParticipantId,
        participantId: current.staffParticipantId,
        departmentIds: [current.departmentId],
      });
      await repository.deleteAssignment(id);
      return c.json({ assignmentId: id }, 200);
    } catch (error) {
      return respondOrganizationError(c, error);
    }
  });
}
