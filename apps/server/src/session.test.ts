import { describe, expect, it, vi } from 'vitest';
import { SessionManager } from './session.js';
import type WebSocket from 'ws';

describe('SessionManager', () => {
  function createSocket(readyState = 1) {
    const send = vi.fn();
    return { send, readyState } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
  }

  it('registers and unregisters sockets', () => {
    const manager = new SessionManager();
    const socket = createSocket();

    manager.register('p1', socket);
    manager.subscribe('p1', 'room-1');
    manager.unregister('p1');

    // After unregister, deliver should be a no-op.
    manager.deliver('p1', { type: 'room.updated', room: { id: 'room-1', name: 'general', participantIds: [], createdAt: new Date().toISOString() } });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('delivers events only to subscribed rooms', () => {
    const manager = new SessionManager();
    const socket = createSocket();

    manager.register('p1', socket);
    manager.subscribe('p1', 'room-1');
    manager.deliver('p1', { type: 'participant.joined', roomId: 'room-2', participant: { id: 'p2', kind: 'human', name: 'other' } });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('delivers events for subscribed rooms', () => {
    const manager = new SessionManager();
    const socket = createSocket();

    manager.register('p1', socket);
    manager.subscribe('p1', 'room-1');
    manager.deliver('p1', { type: 'room.updated', room: { id: 'room-1', name: 'general', participantIds: [], createdAt: new Date().toISOString() } });

    expect(socket.send).toHaveBeenCalledTimes(1);
  });
});
