import { describe, expect, it } from 'vitest';
import { API_ROUTES } from './routes.js';
import { MQTT_TOPICS, parseRoomTopic, parseUplinkTopic } from './wire.js';

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

  it('provides participant registration route', () => {
    expect(API_ROUTES.participants).toBe('/api/v1/participants');
  });

  it('provides mosquitto auth callback routes', () => {
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

  it('parses room topics for ACL checks', () => {
    expect(parseRoomTopic('opc/rooms/room-1/uplink')).toEqual({
      roomId: 'room-1',
      direction: 'uplink',
    });
    expect(parseRoomTopic('opc/rooms/room-1/events')).toEqual({
      roomId: 'room-1',
      direction: 'events',
    });
    expect(parseRoomTopic('opc/rooms/a/b/uplink')).toBeNull();
    expect(parseRoomTopic('$SYS/broker')).toBeNull();
  });
});
