import { describe, expect, it } from 'vitest';
import { createTextMessage } from './message.js';

describe('createTextMessage', () => {
  it('creates a text message with required fields', () => {
    const message = createTextMessage('msg-1', 'room-1', 'user-1', 'hello');

    expect(message.id).toBe('msg-1');
    expect(message.roomId).toBe('room-1');
    expect(message.from).toBe('user-1');
    expect(message.content).toEqual({ type: 'text', body: 'hello' });
    expect(message.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves optional metadata', () => {
    const meta = { replyTo: 'msg-0' };
    const message = createTextMessage('msg-2', 'room-1', 'user-1', 'hi', meta);
    expect(message.metadata).toBe(meta);
  });
});
