import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  CreateRoomResponseSchema,
  GetParticipantResponseSchema,
  GetRoomResponseSchema,
  ListRoomsResponseSchema,
  LoginResponseSchema,
  RegisterParticipantResponseSchema,
  RoomHistoryResponseSchema,
  ServerEventSchema,
  UpdateParticipantResponseSchema,
  UpdateRoomResponseSchema,
  type UplinkPayload,
} from '@logact-pub/opc-protocol';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import { DEFAULT_PASSWORD, registerParticipant, startTestServer, TEST_MQTT } from './helpers.js';

function connectClient(username: string, password: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqttConnect(TEST_MQTT.brokerUrl, { username, password });
    const onError = (err: Error) => {
      client.end(true);
      reject(err);
    };
    client.once('connect', () => {
      client.removeListener('error', onError);
      resolve(client);
    });
    client.once('error', onError);
  });
}

function subscribe(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function publish(client: MqttClient, topic: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

function waitForEvent(client: MqttClient): Promise<unknown> {
  return new Promise((resolve) => {
    client.on('message', (_topic, payload) => {
      resolve(JSON.parse(payload.toString('utf8')));
    });
  });
}

function endClient(client: MqttClient): Promise<void> {
  return new Promise((resolve) => client.end(false, {}, () => resolve()));
}

describe('API contract against @logact-pub/opc-protocol', () => {
  it('rooms and participants endpoints return valid payloads', async () => {
    const { baseUrl, cleanup } = await startTestServer();

    try {
      const registerRes = await fetch(`${baseUrl}${API_ROUTES.participants}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'contract-user',
          name: 'Contract User',
          password: DEFAULT_PASSWORD,
        }),
      });
      expect(registerRes.ok).toBe(true);
      const registerBody = await registerRes.json();
      expect(() => RegisterParticipantResponseSchema.parse(registerBody)).not.toThrow();

      const loginRes = await fetch(`${baseUrl}${API_ROUTES.auth.login}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'contract-user', password: DEFAULT_PASSWORD }),
      });
      expect(loginRes.ok).toBe(true);
      const loginBody = await loginRes.json();
      expect(() => LoginResponseSchema.parse(loginBody)).not.toThrow();
      const authHeaders = { Authorization: `Bearer ${loginBody.accessToken}` };
      const authJsonHeaders = { 'Content-Type': 'application/json', ...authHeaders };

      const getParticipantRes = await fetch(`${baseUrl}${API_ROUTES.participant('contract-user')}`, {
        headers: authHeaders,
      });
      expect(getParticipantRes.ok).toBe(true);
      const getParticipantBody = await getParticipantRes.json();
      expect(() => GetParticipantResponseSchema.parse(getParticipantBody)).not.toThrow();

      const updateParticipantRes = await fetch(`${baseUrl}${API_ROUTES.participant('contract-user')}`, {
        method: 'PATCH',
        headers: authJsonHeaders,
        body: JSON.stringify({ name: 'Updated Name' }),
      });
      expect(updateParticipantRes.ok).toBe(true);
      const updateParticipantBody = await updateParticipantRes.json();
      expect(() => UpdateParticipantResponseSchema.parse(updateParticipantBody)).not.toThrow();

      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: authJsonHeaders,
        body: JSON.stringify({ name: 'contract-room', participantIds: ['contract-user'] }),
      });
      expect(createRes.ok).toBe(true);
      const createBody = CreateRoomResponseSchema.parse(await createRes.json());
      const { roomId } = createBody;

      const listRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, { headers: authHeaders });
      expect(listRes.ok).toBe(true);
      const listBody = await listRes.json();
      expect(() => ListRoomsResponseSchema.parse(listBody)).not.toThrow();

      const getRes = await fetch(`${baseUrl}${API_ROUTES.room(roomId)}`, { headers: authHeaders });
      expect(getRes.ok).toBe(true);
      const getBody = await getRes.json();
      expect(() => GetRoomResponseSchema.parse(getBody)).not.toThrow();

      const updateRes = await fetch(`${baseUrl}${API_ROUTES.room(roomId)}`, {
        method: 'PATCH',
        headers: authJsonHeaders,
        body: JSON.stringify({ name: 'updated-room' }),
      });
      expect(updateRes.ok).toBe(true);
      const updateBody = await updateRes.json();
      expect(() => UpdateRoomResponseSchema.parse(updateBody)).not.toThrow();

      const historyRes = await fetch(`${baseUrl}${API_ROUTES.roomHistory(roomId)}`, {
        headers: authHeaders,
      });
      expect(historyRes.ok).toBe(true);
      const historyBody = await historyRes.json();
      expect(() => RoomHistoryResponseSchema.parse(historyBody)).not.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('MQTT downlink events match ServerEventSchema', async () => {
    const { baseUrl, cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      const token = await registerParticipant('contract-mqtt');

      const loginRes = await fetch(`${baseUrl}${API_ROUTES.auth.login}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'contract-mqtt', password: DEFAULT_PASSWORD }),
      });
      expect(loginRes.ok).toBe(true);
      const { accessToken } = LoginResponseSchema.parse(await loginRes.json());

      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name: 'contract-mqtt-room', participantIds: ['contract-mqtt'] }),
      });
      const { roomId } = CreateRoomResponseSchema.parse(await createRes.json());

      client = await connectClient('contract-mqtt', token);
      await subscribe(client, `opc/rooms/${roomId}/events`);

      const delivered = waitForEvent(client);

      const uplink: UplinkPayload = {
        from: 'contract-mqtt',
        content: { type: 'text', body: 'contract test' },
      };
      await publish(client, `opc/rooms/${roomId}/uplink`, uplink);

      const event = await delivered;
      expect(() => ServerEventSchema.parse(event)).not.toThrow();
    } finally {
      if (client) await endClient(client);
      await cleanup();
    }
  });
});
