/**
 * Conversions between the runtime's transport-agnostic AgentMessage
 * (IAgent.ts) and pi-agent-core / pi-ai transcript messages.
 *
 * Only text crosses the boundary: tool calls, tool results and thinking
 * blocks are execution internals of the pi agent loop and never reach the
 * gateway, so they are dropped on the way out and never produced inbound.
 */

import { randomUUID } from 'node:crypto';
import type { AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { AgentId, AgentMessage, ThreadId } from './IAgent.js';

/** Owning-agent context stamped onto every converted message. */
export interface TranscriptContext {
  agentId: AgentId;
  threadId: ThreadId;
}

/**
 * Converts an inbound AgentMessage into a pi user message for prompt/steer.
 *
 * Non-text content types are flattened into a single text block, minimally
 * marked so the model can still tell them apart: json is fenced, system is
 * prefixed; text/markdown bodies pass through unchanged.
 */
export function toPiUserMessage(message: AgentMessage): UserMessage {
  let text: string;
  switch (message.content.type) {
    case 'json':
      text = `\`\`\`json\n${message.content.body}\n\`\`\``;
      break;
    case 'system':
      text = `[system] ${message.content.body}`;
      break;
    default:
      text = message.content.body;
  }
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: message.timestamp,
  };
}

/** Concatenated text blocks of a pi assistant message ('' when it carries none). */
export function piAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * Converts one pi transcript entry into our AgentMessage.
 *
 * Returns undefined for entries that carry no conversation text: toolResult
 * messages, assistant messages that only hold tool calls / thinking, and the
 * empty assistant failure messages pi synthesizes on run errors. Custom
 * (non-LLM) entries are skipped for the same reason.
 */
export function piMessageToAgentMessage(
  message: PiAgentMessage,
  context: TranscriptContext,
): AgentMessage | undefined {
  if (message.role === 'user') {
    const body =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('');
    if (body.length === 0) return undefined;
    return {
      id: randomUUID(),
      timestamp: message.timestamp ?? Date.now(),
      from: 'user',
      threadId: context.threadId,
      content: { type: 'text', body },
    };
  }
  if (message.role === 'assistant') {
    const body = piAssistantText(message);
    if (body.length === 0) return undefined;
    return {
      id: randomUUID(),
      timestamp: message.timestamp ?? Date.now(),
      from: context.agentId,
      threadId: context.threadId,
      content: { type: 'text', body },
    };
  }
  return undefined;
}

/** Maps a pi transcript (agent.state.messages) to our message history, oldest first. */
export function fromPiTranscript(
  messages: readonly PiAgentMessage[],
  context: TranscriptContext,
): AgentMessage[] {
  const result: AgentMessage[] = [];
  for (const message of messages) {
    const converted = piMessageToAgentMessage(message, context);
    if (converted) result.push(converted);
  }
  return result;
}
