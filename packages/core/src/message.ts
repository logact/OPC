export interface Message {
  id: string;
  roomId: string;
  from: string; // participant id
  content: MessageContent;
  /** ISO 8601 */
  timestamp: string;
  /** 消息级元数据，可携带引用、工具调用、状态等 */
  metadata?: Record<string, unknown>;
}

export interface MessageContent {
  type: 'text' | 'markdown' | 'json' | 'system';
  body: string;
}

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
