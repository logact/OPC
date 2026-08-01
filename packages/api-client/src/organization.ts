import {
  API_ROUTES,
  CreateDepartmentResponseSchema,
  CreatePositionResponseSchema,
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
  ListPositionsResponseSchema,
  ListStaffResponseSchema,
  UpdateDepartmentResponseSchema,
  UpdateOrganizationResponseSchema,
  UpdatePositionResponseSchema,
  UpdateStaffAssignmentResponseSchema,
  type CreateDepartmentRequest,
  type CreateDepartmentResponse,
  type CreatePositionRequest,
  type CreatePositionResponse,
  type CreateStaffAssignmentRequest,
  type CreateStaffAssignmentResponse,
  type DeleteDepartmentResponse,
  type DeletePositionResponse,
  type DeleteStaffAssignmentResponse,
  type GetDepartmentResponse,
  type GetOrganizationResponse,
  type GetOrganizationTreeResponse,
  type GetPositionResponse,
  type GetStaffResponse,
  type ListDepartmentsResponse,
  type ListPositionsQuery,
  type ListPositionsResponse,
  type ListStaffResponse,
  type UpdateDepartmentRequest,
  type UpdateDepartmentResponse,
  type UpdateOrganizationRequest,
  type UpdateOrganizationResponse,
  type UpdatePositionRequest,
  type UpdatePositionResponse,
  type UpdateStaffAssignmentRequest,
  type UpdateStaffAssignmentResponse,
} from '@logact-pub/opc-protocol';
import type { OpcHttpClient } from './http.js';

const API_PREFIX = '/api/v1';
const route = (path: string): string => path.replace(API_PREFIX, '');

export function createOrganizationApi(client: OpcHttpClient) {
  return {
    get: async (): Promise<GetOrganizationResponse> => {
      const data = await client.get<unknown>(route(API_ROUTES.organization));
      return GetOrganizationResponseSchema.parse(data);
    },

    update: async (payload: UpdateOrganizationRequest): Promise<UpdateOrganizationResponse> => {
      const data = await client.patch<unknown>(route(API_ROUTES.organization), payload);
      return UpdateOrganizationResponseSchema.parse(data);
    },

    tree: async (): Promise<GetOrganizationTreeResponse> => {
      const data = await client.get<unknown>(route(API_ROUTES.organizationTree));
      return GetOrganizationTreeResponseSchema.parse(data);
    },

    listDepartments: async (): Promise<ListDepartmentsResponse> => {
      const data = await client.get<unknown>(route(API_ROUTES.organizationDepartments));
      return ListDepartmentsResponseSchema.parse(data);
    },

    createDepartment: async (
      payload: CreateDepartmentRequest
    ): Promise<CreateDepartmentResponse> => {
      const data = await client.post<unknown>(route(API_ROUTES.organizationDepartments), payload);
      return CreateDepartmentResponseSchema.parse(data);
    },

    getDepartment: async (id: string): Promise<GetDepartmentResponse> => {
      const data = await client.get<unknown>(
        route(API_ROUTES.organizationDepartment(encodeURIComponent(id)))
      );
      return GetDepartmentResponseSchema.parse(data);
    },

    updateDepartment: async (
      id: string,
      payload: UpdateDepartmentRequest
    ): Promise<UpdateDepartmentResponse> => {
      const data = await client.patch<unknown>(
        route(API_ROUTES.organizationDepartment(encodeURIComponent(id))),
        payload
      );
      return UpdateDepartmentResponseSchema.parse(data);
    },

    deleteDepartment: async (id: string): Promise<DeleteDepartmentResponse> => {
      const data = await client.delete<unknown>(
        route(API_ROUTES.organizationDepartment(encodeURIComponent(id)))
      );
      return DeleteDepartmentResponseSchema.parse(data);
    },

    listPositions: async (query: ListPositionsQuery = {}): Promise<ListPositionsResponse> => {
      const params = new URLSearchParams();
      if (query.departmentId) params.set('departmentId', query.departmentId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const data = await client.get<unknown>(
        `${route(API_ROUTES.organizationPositions)}${suffix}`
      );
      return ListPositionsResponseSchema.parse(data);
    },

    createPosition: async (payload: CreatePositionRequest): Promise<CreatePositionResponse> => {
      const data = await client.post<unknown>(route(API_ROUTES.organizationPositions), payload);
      return CreatePositionResponseSchema.parse(data);
    },

    getPosition: async (id: string): Promise<GetPositionResponse> => {
      const data = await client.get<unknown>(
        route(API_ROUTES.organizationPosition(encodeURIComponent(id)))
      );
      return GetPositionResponseSchema.parse(data);
    },

    updatePosition: async (
      id: string,
      payload: UpdatePositionRequest
    ): Promise<UpdatePositionResponse> => {
      const data = await client.patch<unknown>(
        route(API_ROUTES.organizationPosition(encodeURIComponent(id))),
        payload
      );
      return UpdatePositionResponseSchema.parse(data);
    },

    deletePosition: async (id: string): Promise<DeletePositionResponse> => {
      const data = await client.delete<unknown>(
        route(API_ROUTES.organizationPosition(encodeURIComponent(id)))
      );
      return DeletePositionResponseSchema.parse(data);
    },

    listStaff: async (): Promise<ListStaffResponse> => {
      const data = await client.get<unknown>(route(API_ROUTES.organizationStaff));
      return ListStaffResponseSchema.parse(data);
    },

    getStaff: async (participantId: string): Promise<GetStaffResponse> => {
      const data = await client.get<unknown>(
        route(API_ROUTES.organizationStaffMember(encodeURIComponent(participantId)))
      );
      return GetStaffResponseSchema.parse(data);
    },

    createStaffAssignment: async (
      participantId: string,
      payload: CreateStaffAssignmentRequest
    ): Promise<CreateStaffAssignmentResponse> => {
      const data = await client.post<unknown>(
        route(API_ROUTES.organizationStaffAssignments(encodeURIComponent(participantId))),
        payload
      );
      return CreateStaffAssignmentResponseSchema.parse(data);
    },

    updateStaffAssignment: async (
      id: string,
      payload: UpdateStaffAssignmentRequest
    ): Promise<UpdateStaffAssignmentResponse> => {
      const data = await client.patch<unknown>(
        route(API_ROUTES.organizationAssignment(encodeURIComponent(id))),
        payload
      );
      return UpdateStaffAssignmentResponseSchema.parse(data);
    },

    deleteStaffAssignment: async (id: string): Promise<DeleteStaffAssignmentResponse> => {
      const data = await client.delete<unknown>(
        route(API_ROUTES.organizationAssignment(encodeURIComponent(id)))
      );
      return DeleteStaffAssignmentResponseSchema.parse(data);
    },
  };
}
