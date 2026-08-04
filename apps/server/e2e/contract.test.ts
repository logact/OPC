import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  CreateRoomResponseSchema,
  GetParticipantResponseSchema,
  GetRoomResponseSchema,
  ListRoomsResponseSchema,
  LoginResponseSchema,
  MQTT_TOPICS,
  PresencePayloadSchema,
  RegisterParticipantResponseSchema,
  RoomHistoryResponseSchema,
  ServerEventSchema,
  UpdateParticipantResponseSchema,
  UpdateRoomResponseSchema,
  type UplinkPayload,
} from '@logact-pub/opc-protocol';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import {
  createAuthenticatedHttpClient,
  DEFAULT_PASSWORD,
  getOwnerAccessToken,
  grantCapabilities,
  registerParticipant,
  SELF_MESSAGING_GRANTS,
  startTestServer,
  TEST_MQTT,
} from './helpers.js';

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
      const ownerHttp = await createAuthenticatedHttpClient();

      // 注册新 participant 必须由已认证 Owner 执行（空库首个 human 除外）
      const registerBody = await ownerHttp.registerParticipant(
        'contract-user',
        'Contract User',
        DEFAULT_PASSWORD
      );
      expect(() => RegisterParticipantResponseSchema.parse(registerBody)).not.toThrow();

      const loginRes = await fetch(`${baseUrl}${API_ROUTES.auth.login}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'contract-user', password: DEFAULT_PASSWORD }),
      });
      expect(loginRes.ok).toBe(true);
      const loginBody = await loginRes.json();
      expect(() => LoginResponseSchema.parse(loginBody)).not.toThrow();
      // 读取/更新 participant 与房间需要相应 capability（issue #112 RBAC）；
      // 新注册的非 Owner participant 默认无 position grant，以下断言以 Owner 身份执行。
      const authHeaders = { Authorization: `Bearer ${getOwnerAccessToken()}` };
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

      // 创建房间需要 room.create 能力；非 Owner participant 默认无此权限，使用 Owner 创建
      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getOwnerAccessToken()}`,

        },
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
      const ownerHttp = await createAuthenticatedHttpClient();
      // #112：订阅 events topic 需 message.read、uplink 发布需 message.send，
      // 由 Owner 通过 position 授予（self scope 覆盖其所在房间）
      await grantCapabilities('contract-mqtt', SELF_MESSAGING_GRANTS);

      const loginRes = await fetch(`${baseUrl}${API_ROUTES.auth.login}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'contract-mqtt', password: DEFAULT_PASSWORD }),
      });
      expect(loginRes.ok).toBe(true);
      LoginResponseSchema.parse(await loginRes.json());

      const { roomId } = await ownerHttp.createRoom({
        name: 'contract-mqtt-room',
        participantIds: ['contract-mqtt'],
      });

      client = await connectClient('contract-mqtt', token);
      await subscribe(client, `opc/rooms/${roomId}/events`);

      const delivered = waitForEvent(client);

      const uplink: UplinkPayload = {
        from: 'contract-mqtt',
        content: { type: 'text', body: 'contract test' },
      };
      await publish(client, MQTT_TOPICS.participantUplink('contract-mqtt', roomId), uplink);

      const event = await delivered;
      expect(() => ServerEventSchema.parse(event)).not.toThrow();
    } finally {
      if (client) await endClient(client);
      await cleanup();
    }
  });

  it('presence topic payloads match PresencePayloadSchema', async () => {
    const { cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      const token = await registerParticipant('contract-presence');
      client = await connectClient('contract-presence', token);

      // participant 可读写自己的 presence topic（ACL 见 server checkAcl）
      await subscribe(client, MQTT_TOPICS.presence('contract-presence'));
      const received = waitForEvent(client);
      await publish(client, MQTT_TOPICS.presence('contract-presence'), { online: true });

      const payload = await received;
      expect(() => PresencePayloadSchema.parse(payload)).not.toThrow();
    } finally {
      if (client) await endClient(client);
      await cleanup();
    }
  });
});
