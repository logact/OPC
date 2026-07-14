import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import { MQTT_TOPICS } from '@opc/protocol';
import type { ServerEvent } from '@opc/core';
import type { MessageRepository, ParticipantRepository, RoomRepository } from '@opc/database';
import { createMqttBridge } from './mqtt-bridge.js';

class FakeMqttClient extends EventEmitter {
  subscribe = vi.fn((_topic: string, _opts: unknown, cb?: (err: Error | null) => void) => cb?.(null));
  publish = vi.fn();
  end = vi.fn((_force: boolean, _opts: unknown, cb?: () => void) => cb?.());
}

function createRepos() {
  const ensure = vi
    .fn()
    .mockResolvedValue({ id: 'alice', kind: 'human', name: 'alice' });
  const findById = vi
    .fn()
    .mockResolvedValue({ id: 'room-1', name: 'r', participantIds: ['alice'], createdAt: '' });
  const insert = vi.fn().mockResolvedValue(undefined);
  return {
    participantRepo: { ensure } as unknown as ParticipantRepository,
    roomRepo: { findById } as unknown as RoomRepository,
    messageRepo: { insert } as unknown as MessageRepository,
    mocks: { ensure, findById, insert },
  };
}

function createBridge(fake: FakeMqttClient, repos: ReturnType<typeof createRepos>) {
  return createMqttBridge({
    brokerUrl: 'mqtt://test',
    username: 'u',
    password: 'p',
    participantRepo: repos.participantRepo,
    roomRepo: repos.roomRepo,
    messageRepo: repos.messageRepo,
    connectFn: () => fake as unknown as MqttClient,
  });
}

describe('createMqttBridge', () => {
  it('subscribes the uplink filter once connected', async () => {
    const fake = new FakeMqttClient();
    const bridge = createBridge(fake, createRepos());

    fake.emit('connect');
    await bridge.ready;

    expect(fake.subscribe).toHaveBeenCalledWith(
      MQTT_TOPICS.uplinkFilter,
      { qos: 1 },
      expect.any(Function)
    );
  });

  it('persists uplink messages and republishes as message.delivered events', async () => {
    const fake = new FakeMqttClient();
    const repos = createRepos();
    const bridge = createBridge(fake, repos);

    fake.emit('connect');
    await bridge.ready;

    fake.emit(
      'message',
      'opc/rooms/room-1/uplink',
      Buffer.from(JSON.stringify({ from: 'alice', content: { type: 'text', body: 'hi' } }))
    );

    await vi.waitFor(() => expect(repos.mocks.insert).toHaveBeenCalled());

    expect(repos.mocks.ensure).toHaveBeenCalledWith('alice');
    expect(fake.publish).toHaveBeenCalledWith(
      'opc/rooms/room-1/events',
      expect.any(String),
      { qos: 1 }
    );

    const event = JSON.parse(String(fake.publish.mock.calls[0][1])) as ServerEvent;
    expect(event.type).toBe('message.delivered');
    if (event.type !== 'message.delivered') throw new Error('unexpected event');
    expect(event.message.roomId).toBe('room-1');
    expect(event.message.from).toBe('alice');
    expect(event.message.content).toEqual({ type: 'text', body: 'hi' });
  });

  it('drops messages for unknown rooms', async () => {
    const fake = new FakeMqttClient();
    const repos = createRepos();
    repos.mocks.findById.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = createBridge(fake, repos);

    fake.emit('connect');
    await bridge.ready;

    fake.emit(
      'message',
      'opc/rooms/ghost/uplink',
      Buffer.from(JSON.stringify({ from: 'alice', content: { type: 'text', body: 'hi' } }))
    );

    await vi.waitFor(() => expect(repos.mocks.findById).toHaveBeenCalled());
    // 等待异步 handleUplink 走完
    await new Promise((resolve) => setImmediate(resolve));

    expect(repos.mocks.insert).not.toHaveBeenCalled();
    expect(fake.publish).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops malformed payloads', async () => {
    const fake = new FakeMqttClient();
    const repos = createRepos();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = createBridge(fake, repos);

    fake.emit('connect');
    await bridge.ready;

    fake.emit('message', 'opc/rooms/room-1/uplink', Buffer.from('not json'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(repos.mocks.findById).not.toHaveBeenCalled();
    expect(repos.mocks.insert).not.toHaveBeenCalled();
    expect(fake.publish).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
