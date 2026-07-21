/* eslint-disable @typescript-eslint/unbound-method */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@logact-pub/opc-protocol';
import type { Agent } from './agent.js';
import { Gateway } from './gateway.js';

function fakeAgent(id: string): Agent {
  return {
    config: { id, name: id, engine: 'shell' },
    client: { events: new EventEmitter() },
    start: vi.fn(async () => {}),
    handleTask: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  } as unknown as Agent;
}

function message(id: string, from: string, body: string): { message: Message } {
  return {
    message: { id, roomId: 'room-1', from, content: { type: 'text', body }, timestamp: new Date().toISOString() },
  };
}

describe('Gateway routing', () => {
  it('routes @mention to the mentioned agent', async () => {
    const a1 = fakeAgent('agent1');
    const a2 = fakeAgent('agent2');
    const gateway = new Gateway([a1, a2], 'agent1');
    await gateway.start();

    (a1.client.events as EventEmitter).emit('message.delivered', message('m1', 'user1', '@agent2 list files'));
    await vi.waitFor(() => expect(a2.handleTask).toHaveBeenCalledWith('list files'));
    expect(a1.handleTask).not.toHaveBeenCalled();
  });

  it('routes unmentioned messages to the default agent', async () => {
    const a1 = fakeAgent('agent1');
    const a2 = fakeAgent('agent2');
    const gateway = new Gateway([a1, a2], 'agent1');
    await gateway.start();

    (a2.client.events as EventEmitter).emit('message.delivered', message('m2', 'user1', 'hello'));
    await vi.waitFor(() => expect(a1.handleTask).toHaveBeenCalledWith('hello'));
  });

  it('ignores messages from agent participants (no loops)', async () => {
    const a1 = fakeAgent('agent1');
    const gateway = new Gateway([a1], 'agent1');
    await gateway.start();

    (a1.client.events as EventEmitter).emit('message.delivered', message('m3', 'agent1', '[agent1] done'));
    await new Promise((r) => setTimeout(r, 20));
    expect(a1.handleTask).not.toHaveBeenCalled();
  });

  it('dedupes the same message delivered on multiple connections', async () => {
    const a1 = fakeAgent('agent1');
    const a2 = fakeAgent('agent2');
    const gateway = new Gateway([a1, a2], 'agent1');
    await gateway.start();

    const event = message('m4', 'user1', 'hi');
    (a1.client.events as EventEmitter).emit('message.delivered', event);
    (a2.client.events as EventEmitter).emit('message.delivered', event);
    await vi.waitFor(() => expect(a1.handleTask).toHaveBeenCalledTimes(1));
  });

  it('falls back to default agent for unknown mentions', async () => {
    const a1 = fakeAgent('agent1');
    const gateway = new Gateway([a1], 'agent1');
    await gateway.start();

    (a1.client.events as EventEmitter).emit('message.delivered', message('m5', 'user1', '@ghost hi'));
    await vi.waitFor(() => expect(a1.handleTask).toHaveBeenCalledWith('@ghost hi'));
  });
});
