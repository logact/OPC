import { describe, expect, it } from 'vitest';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import { API_ROUTES, MQTT_TOPICS, type UplinkPayload } from '@opc/protocol';
import type { ServerEvent } from '@opc/core';
import { registerParticipant, startTestServer, TEST_MQTT } from './helpers.js';

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

function subscribe(client: MqttClient, topic: string): Promise<number> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (err, granted) => {
      if (err) return reject(err);
      resolve(granted?.[0]?.qos ?? -1);
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

function waitForEvent(client: MqttClient): Promise<ServerEvent> {
  return new Promise((resolve) => {
    client.on('message', (_topic, payload) => {
      resolve(JSON.parse(payload.toString('utf8')) as ServerEvent);
    });
  });
}

function endClient(client: MqttClient): Promise<void> {
  return new Promise((resolve) => client.end(false, {}, () => resolve()));
}

describe('OPC Server E2E', () => {
  it('registers participants and manages rooms via HTTP', async () => {
    const { baseUrl, cleanup } = await startTestServer();

    try {
      const token = await registerParticipant('user-1');
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'e2e-room', participantIds: ['user-1'] }),
      });
      expect(createRes.ok).toBe(true);
      const { roomId } = (await createRes.json()) as { roomId: string };
      expect(roomId).toBeDefined();

      const listRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`);
      expect(listRes.ok).toBe(true);
      const { rooms } = (await listRes.json()) as { rooms: { id: string; name: string }[] };
      expect(rooms.some((r) => r.id === roomId && r.name === 'e2e-room')).toBe(true);

      const historyRes = await fetch(`${baseUrl}${API_ROUTES.roomHistory(roomId)}`);
      expect(historyRes.ok).toBe(true);
      const { messages } = (await historyRes.json()) as { messages: unknown[] };
      expect(messages).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('exchanges messages via MQTT through the server bridge', async () => {
    const { baseUrl, cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      const token = await registerParticipant('alice');

      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'mqtt-room', participantIds: ['alice'] }),
      });
      const { roomId } = (await createRes.json()) as { roomId: string };

      client = await connectClient('alice', token);

      const granted = await subscribe(client, MQTT_TOPICS.events(roomId));
      expect(granted).toBe(1);

      const delivered = waitForEvent(client);

      const uplink: UplinkPayload = {
        from: 'alice',
        content: { type: 'text', body: 'hello e2e' },
      };
      await publish(client, MQTT_TOPICS.uplink(roomId), uplink);

      const event = await delivered;
      expect(event.type).toBe('message.delivered');
      if (event.type !== 'message.delivered') throw new Error('unexpected event');
      expect(event.message.from).toBe('alice');
      expect(event.message.roomId).toBe(roomId);
      expect(event.message.content.body).toBe('hello e2e');

      // 消息已落库
      const historyRes = await fetch(`${baseUrl}${API_ROUTES.roomHistory(roomId)}`);
      const { messages } = (await historyRes.json()) as { messages: { content: { body: string } }[] };
      expect(messages.some((m) => m.content.body === 'hello e2e')).toBe(true);
    } finally {
      if (client) await endClient(client);
      await cleanup();
    }
  });

  it('rejects non-member subscription at the broker (ACL)', async () => {
    const { baseUrl, cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      await registerParticipant('alice');
      const eveToken = await registerParticipant('eve');

      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'private-room', participantIds: ['alice'] }),
      });
      const { roomId } = (await createRes.json()) as { roomId: string };

      // eve 是合法参与者（可连接），但不是房间成员（不可订阅）
      client = await connectClient('eve', eveToken);

      // mqtt.js 对订阅拒绝可能回传 err 或 granted qos 0x80，两种都视为拒绝
      const result = await new Promise<{ err?: Error; qos?: number }>((resolve) => {
        client!.subscribe(MQTT_TOPICS.events(roomId), { qos: 1 }, (err, granted) => {
          resolve({ err: err ?? undefined, qos: granted?.[0]?.qos });
        });
      });
      expect(result.err !== undefined || result.qos === 0x80).toBe(true);
    } finally {
      if (client) await endClient(client);
      await cleanup();
    }
  });

  it('rejects invalid credentials at connect', async () => {
    const { cleanup } = await startTestServer();

    try {
      await expect(connectClient('alice', 'wrong-token')).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });
});
