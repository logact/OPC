import type { Message } from '@logact-pub/opc-protocol';

export function createTextMessage(
  id: string,
  roomId: string,
  from: string,
  text: string,
  metadata?: Record<string, unknown>
): Message {
  return {
    id,
    roomId,
    from,
    content: { type: 'text', body: text },
    timestamp: new Date().toISOString(),
    metadata,
  };
}
