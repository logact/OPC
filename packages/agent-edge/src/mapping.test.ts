import { describe, expect, it } from 'vitest';
import type { AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import type { ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { AgentMessage } from './IAgent.js';
import {
  fromPiTranscript,
  piAssistantText,
  piMessageToAgentMessage,
  toPiUserMessage,
} from './mapping.js';
import { fakeAssistantMessage } from './testing.js';

const CTX = { agentId: 'agent-1', threadId: 'thread-1' };

function inbound(content: AgentMessage['content']): AgentMessage {
  return {
    id: 'm1',
    timestamp: 1000,
    from: 'user',
    threadId: 'thread-1',
    content,
  };
}

describe('toPiUserMessage', () => {
  it('passes text and markdown bodies through unchanged', () => {
    expect(toPiUserMessage(inbound({ type: 'text', body: 'hello' }))).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 1000,
    });
    const md = toPiUserMessage(inbound({ type: 'markdown', body: '**bold**' }));
    expect(md.content).toEqual([{ type: 'text', text: '**bold**' }]);
  });

  it('fences json bodies and prefixes system bodies', () => {
    const json = toPiUserMessage(inbound({ type: 'json', body: '{"a":1}' }));
    expect(json.content).toEqual([{ type: 'text', text: '```json\n{"a":1}\n```' }]);
    const system = toPiUserMessage(inbound({ type: 'system', body: 'reboot' }));
    expect(system.content).toEqual([{ type: 'text', text: '[system] reboot' }]);
  });
});

describe('piMessageToAgentMessage / fromPiTranscript', () => {
  it('maps user messages with string content', () => {
    const user: UserMessage = { role: 'user', content: 'hi there', timestamp: 42 };
    const mapped = piMessageToAgentMessage(user, CTX);
    expect(mapped).toMatchObject({
      from: 'user',
      threadId: 'thread-1',
      timestamp: 42,
      content: { type: 'text', body: 'hi there' },
    });
    expect(mapped?.id).toBeTruthy();
  });

  it('maps user messages with block content, dropping image blocks', () => {
    const user: UserMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'look ' },
        { type: 'image', data: 'zzz', mimeType: 'image/png' },
        { type: 'text', text: 'here' },
      ],
      timestamp: 43,
    };
    expect(piMessageToAgentMessage(user, CTX)?.content.body).toBe('look here');
  });

  it('maps assistant text to the owning agent id', () => {
    const mapped = piMessageToAgentMessage(fakeAssistantMessage('answer'), CTX);
    expect(mapped).toMatchObject({
      from: 'agent-1',
      threadId: 'thread-1',
      content: { type: 'text', body: 'answer' },
    });
  });

  it('skips tool results, tool-call-only and empty assistant messages', () => {
    const toolResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'ls',
      content: [{ type: 'text', text: 'files' }],
      isError: false,
      timestamp: 44,
    };
    const toolCallOnly = fakeAssistantMessage('');
    toolCallOnly.content = [{ type: 'toolCall', id: 'c1', name: 'ls', arguments: {} }];
    const emptyFailure = fakeAssistantMessage('', 'error', 'boom');

    const transcript: PiAgentMessage[] = [
      { role: 'user', content: 'q', timestamp: 1 },
      toolResult,
      toolCallOnly,
      emptyFailure,
      fakeAssistantMessage('a'),
    ];
    const mapped = fromPiTranscript(transcript, CTX);
    expect(mapped.map((m) => m.content.body)).toEqual(['q', 'a']);
    expect(mapped.map((m) => m.from)).toEqual(['user', 'agent-1']);
  });

  it('mints unique ids for every converted message', () => {
    const transcript: PiAgentMessage[] = [
      { role: 'user', content: 'q', timestamp: 1 },
      fakeAssistantMessage('a'),
    ];
    const mapped = fromPiTranscript(transcript, CTX);
    expect(mapped[0]?.id).not.toBe(mapped[1]?.id);
  });
});

describe('piAssistantText', () => {
  it('concatenates only text blocks', () => {
    const message = fakeAssistantMessage('one');
    message.content = [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'one' },
      { type: 'text', text: ' two' },
    ];
    expect(piAssistantText(message)).toBe('one two');
  });
});
