import type { Message, MessageContent, MessageIntent } from '@logact-pub/opc-protocol';

export function createMessage(
  id: string,
  roomId: string,
  from: string,
  content: MessageContent,
  metadata?: Record<string, unknown>,
  intent?: MessageIntent
): Message {
  return {
    id,
    roomId,
    from,
    content,
    timestamp: new Date().toISOString(),
    metadata,
    intent,
  };
}

export function createTextMessage(
  id: string,
  roomId: string,
  from: string,
  text: string,
  metadata?: Record<string, unknown>,
  intent?: MessageIntent
): Message {
  return {
    id,
    roomId,
    from,
    content: { type: 'text', body: text },
    timestamp: new Date().toISOString(),
    metadata,
    intent,
  };
}
