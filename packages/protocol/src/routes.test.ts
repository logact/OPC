import { describe, expect, it } from 'vitest';
import {
  CreatePositionRequestSchema,
  DepartmentNodeSchema,
  GatewayCommandSchema,
  OrganizationErrorResponseSchema,
  ReadUpdatedEventSchema,
  RegisterParticipantRequestSchema,
  RoomReadsPayloadSchema,
  RoomReadStateResponseSchema,
  ServerEventSchema,
  UpdateDepartmentRequestSchema,
} from './schemas.js';
import * as Schemas from './schemas.js';
import { API_ROUTES } from './routes.js';
import * as Wire from './wire.js';
import {
  MQTT_TOPICS,
  parseGatewayControlTopic,
  parseParticipantReadsTopic,
  parseRoomTopic,
} from './wire.js';

interface AuthorizationMqttContract {
  participantUplinkFilter: string;
  participantUplink(participantId: string, roomId: string): string;
}

interface AuthorizationWireContract {
  parseParticipantUplinkTopic(topic: string): { participantId: string; roomId: string } | null;
}

interface RuntimeSchema {
  parse(value: unknown): unknown;
}

interface AuthorizationSchemaContract {
  CapabilityNameSchema: RuntimeSchema;
  AuthorizationResourceSchema: RuntimeSchema;
}

describe('API_ROUTES', () => {
  it('provides room collection route', () => {
    expect(API_ROUTES.rooms).toBe('/api/v1/rooms');
  });

  it('builds single room route', () => {
    expect(API_ROUTES.room('room-1')).toBe('/api/v1/rooms/room-1');
  });

  it('builds room history route', () => {
    expect(API_ROUTES.roomHistory('room-1')).toBe('/api/v1/rooms/room-1/history');
  });

  it('builds room read-state route', () => {
    expect(API_ROUTES.roomReadState('room-1')).toBe('/api/v1/rooms/room-1/read-state');
  });

  it('provides participant registration route', () => {
    expect(API_ROUTES.participants).toBe('/api/v1/participants');
  });

  it('builds single participant route', () => {
    expect(API_ROUTES.participant('alice')).toBe('/api/v1/participants/alice');
  });

  it('provides organization routes', () => {
    expect(API_ROUTES.organization).toBe('/api/v1/organization');
    expect(API_ROUTES.organizationTree).toBe('/api/v1/organization/tree');
    expect(API_ROUTES.organizationDepartment('dep-1')).toBe(
      '/api/v1/organization/departments/dep-1'
    );
    expect(API_ROUTES.organizationPosition('pos-1')).toBe(
      '/api/v1/organization/positions/pos-1'
    );
    expect(API_ROUTES.organizationStaffMember('alice')).toBe(
      '/api/v1/organization/staff/alice'
    );
    expect(API_ROUTES.organizationStaffAssignments('alice')).toBe(
      '/api/v1/organization/staff/alice/assignments'
    );
    expect(API_ROUTES.organizationAssignment('assignment-1')).toBe(
      '/api/v1/organization/assignments/assignment-1'
    );
  });

  it('provides message collection route', () => {
    expect(API_ROUTES.messages).toBe('/api/v1/messages');
  });

  it('builds single message route', () => {
    expect(API_ROUTES.message('msg-1')).toBe('/api/v1/messages/msg-1');
  });

  it('provides auth routes', () => {
    expect(API_ROUTES.auth.login).toBe('/api/v1/auth/login');
    expect(API_ROUTES.auth.mqttUser).toBe('/api/v1/auth/mqtt/user');
    expect(API_ROUTES.auth.mqttSuperuser).toBe('/api/v1/auth/mqtt/superuser');
    expect(API_ROUTES.auth.mqttAcl).toBe('/api/v1/auth/mqtt/acl');
  });
});

describe('MQTT_TOPICS', () => {
  it('builds events topic', () => {
    expect(MQTT_TOPICS.events('room-1')).toBe('opc/rooms/room-1/events');
  });

  it('binds participant uplink topic', () => {
    const topics = MQTT_TOPICS as unknown as AuthorizationMqttContract;
    const wire = Wire as unknown as AuthorizationWireContract;
    expect(topics.participantUplink('alice', 'room-1')).toBe(
      'opc/participants/alice/rooms/room-1/uplink'
    );
    expect(topics.participantUplinkFilter).toBe('opc/participants/+/rooms/+/uplink');
    expect(
      wire.parseParticipantUplinkTopic('opc/participants/alice/rooms/room-1/uplink')
    ).toEqual({ participantId: 'alice', roomId: 'room-1' });
    expect(wire.parseParticipantUplinkTopic('opc/rooms/room-1/uplink')).toBeNull();
  });

  it('builds reads topics and parses actor from reads topic', () => {
    expect(MQTT_TOPICS.participantReads('alice', 'room-1')).toBe(
      'opc/participants/alice/rooms/room-1/reads'
    );
    expect(MQTT_TOPICS.participantReadsFilter).toBe('opc/participants/+/rooms/+/reads');
    expect(parseParticipantReadsTopic('opc/participants/alice/rooms/room-1/reads')).toEqual({
      participantId: 'alice',
      roomId: 'room-1',
    });
    expect(parseParticipantReadsTopic('opc/rooms/room-1/reads')).toBeNull();
    expect(parseParticipantReadsTopic('random/topic')).toBeNull();
  });

  it('parses room topics for ACL checks', () => {
    expect(parseRoomTopic('opc/rooms/room-1/events')).toEqual({
      roomId: 'room-1',
      direction: 'events',
    });
    expect(parseRoomTopic('opc/rooms/room-1/uplink')).toBeNull();
    expect(parseRoomTopic('opc/rooms/a/b/events')).toBeNull();
    expect(parseRoomTopic('opc/participants/alice/rooms/room-1/reads')).toEqual({
      participantId: 'alice',
      roomId: 'room-1',
      direction: 'reads',
    });
    expect(parseRoomTopic('$SYS/broker')).toBeNull();
  });

  it('builds gateway control topic', () => {
    expect(MQTT_TOPICS.gatewayControl('gw-1')).toBe('opc/gateways/gw-1/control');
  });

  it('parses gatewayId from control topic', () => {
    expect(parseGatewayControlTopic('opc/gateways/gw-1/control')).toBe('gw-1');
    expect(parseGatewayControlTopic('opc/gateways/gw-1/extra/control')).toBeNull();
    expect(parseGatewayControlTopic('opc/rooms/room-1/events')).toBeNull();
  });
});

describe('GatewayCommandSchema', () => {
  it('parses agent.spawn command', () => {
    const cmd = { type: 'agent.spawn', participantId: 'lobe', token: 'tok' };
    expect(GatewayCommandSchema.parse(cmd)).toEqual(cmd);
  });

  it('parses agent.stop command', () => {
    const cmd = { type: 'agent.stop', participantId: 'lobe' };
    expect(GatewayCommandSchema.parse(cmd)).toEqual(cmd);
  });

  it('rejects unknown command types', () => {
    expect(() => GatewayCommandSchema.parse({ type: 'agent.restart', participantId: 'lobe' })).toThrow();
  });
});

describe('RegisterParticipantRequestSchema', () => {
  it('accepts human registration without kind', () => {
    const parsed = RegisterParticipantRequestSchema.parse({ id: 'alice', password: 'secret123' });
    expect(parsed).toEqual({ id: 'alice', password: 'secret123' });
  });

  it('accepts agent registration with gatewayId', () => {
    const parsed = RegisterParticipantRequestSchema.parse({
      id: 'lobe',
      kind: 'agent',
      gatewayId: 'gw-1',
    });
    expect(parsed).toEqual({ id: 'lobe', kind: 'agent', gatewayId: 'gw-1' });
  });
});

describe('RoomReadsPayloadSchema', () => {
  it('parses a read receipt payload', () => {
    const payload = { from: 'alice', lastReadAt: '2026-08-05T12:00:00.000Z' };
    expect(RoomReadsPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('accepts a payload without from (actor bound by topic)', () => {
    const payload = { lastReadAt: '2026-08-05T12:00:00.000Z' };
    expect(RoomReadsPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('rejects non-ISO lastReadAt', () => {
    expect(() =>
      RoomReadsPayloadSchema.parse({ from: 'alice', lastReadAt: 'not-a-date' })
    ).toThrow();
  });
});

describe('ReadUpdatedEventSchema', () => {
  it('parses and is part of the ServerEvent union', () => {
    const event = {
      type: 'read.updated',
      roomId: 'room-1',
      participantId: 'alice',
      lastReadAt: '2026-08-05T12:00:00.000Z',
    };
    expect(ReadUpdatedEventSchema.parse(event)).toEqual(event);
    expect(ServerEventSchema.parse(event)).toEqual(event);
  });
});

describe('RoomReadStateResponseSchema', () => {
  it('accepts members that never read with null cursor', () => {
    const response = {
      reads: [
        { participantId: 'alice', lastReadAt: '2026-08-05T12:00:00.000Z' },
        { participantId: 'bob', lastReadAt: null },
      ],
    };
    expect(RoomReadStateResponseSchema.parse(response)).toEqual(response);
  });
});

describe('organization schemas', () => {
  it('owns the closed capability catalog without department-scoped task capabilities', () => {
    const schemas = Schemas as unknown as AuthorizationSchemaContract;
    expect(schemas.CapabilityNameSchema.parse('participant.read')).toBe('participant.read');
    expect(schemas.CapabilityNameSchema.parse('message.send')).toBe('message.send');
    // issue #130：任务授权改为角色制，task.* capability 整体移除
    expect(() => schemas.CapabilityNameSchema.parse('task.review')).toThrow();
    expect(() => schemas.CapabilityNameSchema.parse('task.manage')).toThrow();
    expect(() => schemas.CapabilityNameSchema.parse('legacy.arbitrary')).toThrow();
    // task 不再是 capability 授权资源
    expect(() =>
      schemas.AuthorizationResourceSchema.parse({
        type: 'task',
        id: 'task-1',
        departmentId: 'department-1',
        creatorId: 'alice',
        assigneeId: 'agent-1',
      })
    ).toThrow();
  });

  it('normalizes and deterministically sorts position skill tags', () => {
    const parsed = CreatePositionRequestSchema.parse({
      departmentId: 'department-1',
      name: 'Engineer',
      skillTags: ['TypeScript', 'mqtt', 'typescript'],
    });
    expect(parsed.skillTags).toEqual(['mqtt', 'typescript']);
  });

  it('rejects an empty department update', () => {
    expect(() => UpdateDepartmentRequestSchema.parse({})).toThrow();
  });

  it('parses recursive department nodes', () => {
    const department = {
      id: 'department-1',
      organizationId: 'default',
      name: 'Platform',
      parentId: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      positions: [],
      leaders: [],
      children: [],
    };
    expect(DepartmentNodeSchema.parse({ ...department, children: [department] }).children).toHaveLength(1);
  });

  it('pins structured organization error codes', () => {
    expect(
      OrganizationErrorResponseSchema.parse({
        error: { code: 'department_cycle', message: 'cycle rejected' },
      })
    ).toEqual({ error: { code: 'department_cycle', message: 'cycle rejected' } });
  });
});
