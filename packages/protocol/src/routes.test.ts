import { describe, expect, it } from 'vitest';
import {
  GatewayCommandSchema,
  ReadUpdatedEventSchema,
  RegisterParticipantRequestSchema,
  RoomReadsPayloadSchema,
  RoomReadStateResponseSchema,
  ServerEventSchema,
} from './schemas.js';
import { API_ROUTES } from './routes.js';
import {
  MQTT_TOPICS,
  parseGatewayControlTopic,
  parseReadsTopic,
  parseRoomTopic,
  parseUplinkTopic,
} from './wire.js';

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
  it('builds uplink and events topics', () => {
    expect(MQTT_TOPICS.uplink('room-1')).toBe('opc/rooms/room-1/uplink');
    expect(MQTT_TOPICS.events('room-1')).toBe('opc/rooms/room-1/events');
    expect(MQTT_TOPICS.uplinkFilter).toBe('opc/rooms/+/uplink');
  });

  it('parses roomId from uplink topic', () => {
    expect(parseUplinkTopic('opc/rooms/room-1/uplink')).toBe('room-1');
    expect(parseUplinkTopic('opc/rooms/room-1/events')).toBeNull();
    expect(parseUplinkTopic('random/topic')).toBeNull();
  });

  it('builds reads topics and parses roomId from reads topic', () => {
    expect(MQTT_TOPICS.reads('room-1')).toBe('opc/rooms/room-1/reads');
    expect(MQTT_TOPICS.readsFilter).toBe('opc/rooms/+/reads');
    expect(parseReadsTopic('opc/rooms/room-1/reads')).toBe('room-1');
    expect(parseReadsTopic('opc/rooms/room-1/uplink')).toBeNull();
    expect(parseReadsTopic('random/topic')).toBeNull();
  });

  it('parses room topics for ACL checks', () => {
    expect(parseRoomTopic('opc/rooms/room-1/uplink')).toEqual({
      roomId: 'room-1',
      direction: 'uplink',
    });
    expect(parseRoomTopic('opc/rooms/room-1/events')).toEqual({
      roomId: 'room-1',
      direction: 'events',
    });
    expect(parseRoomTopic('opc/rooms/room-1/reads')).toEqual({
      roomId: 'room-1',
      direction: 'reads',
    });
    expect(parseRoomTopic('opc/rooms/a/b/uplink')).toBeNull();
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
