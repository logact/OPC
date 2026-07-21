import type { Participant } from '@opc/api-client';
import { roomsApi } from '../api/http';
import { getAgent, type AgentMeta } from './registry';

/**
 * DEV-only simulation of remote agent replies (prototype sendMsg/agentReply).
 * Per the Q2 decision no real endpoint is invoked: replies are canned texts
 * sent via roomsApi.broadcast with `from` set to the agent, so they arrive
 * through the normal MQTT/history path as genuine room messages.
 *
 * Maestro flow 11-agent-reply (tag `simulation`, CI-excluded) depends on this
 * being enabled in dev builds. Flip to false to disable locally.
 */
export const SIMULATE_AGENT_REPLIES: boolean = __DEV__;

// Prototype timing: typing appears ~700ms after send, the reply replaces it
// ~1.6s later; simultaneous replies are staggered by 1.4s.
const TYPING_DELAY_MS = 700;
const REPLY_DELAY_MS = 1600;
const STAGGER_MS = 1400;
// Failsafe so a typing row never gets stuck on screen.
const TYPING_SAFETY_TIMEOUT_MS = 10_000;

export interface SimulateAgentRepliesOptions {
  roomId: string;
  text: string;
  /** Agent participants of the room (excluding the current user). */
  agents: Participant[];
  /** True when the room is a DM whose other participant is an agent. */
  isDirectDM: boolean;
  onTypingChange: (agent: Participant, isTyping: boolean) => void;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Agents @mentioned in the text: `@AgentName`, case-insensitive, flexible whitespace. */
function findMentionedAgents(text: string, agents: Participant[]): Participant[] {
  return agents.filter((agent) => {
    const name = agent.name ?? agent.id;
    const pattern = new RegExp(`@${escapeRegExp(name).replace(/\s+/g, '\\s*')}`, 'i');
    return pattern.test(text);
  });
}

function pickReplyBody(meta: AgentMeta | null, userText: string): string {
  const job = Math.floor(Math.random() * 900 + 100);
  const snippet = userText.length > 40 ? `${userText.slice(0, 40)}…` : userText;
  // Canned replies modeled on the prototype's, referencing the local
  // registry's endpoint/protocol when the agent is registered on-device.
  const replies = [
    meta
      ? `Received. Running task on my remote host (${meta.endpoint}) — will report back here.`
      : 'Received. Running task on my remote host — will report back here.',
    'Done. Result synced to this chat; full log archived on the agent node.',
    meta
      ? `Acknowledged via ${meta.protocol}. Queued as job #${job}.`
      : `Acknowledged. Queued as job #${job}.`,
    `Here's my take: ${snippet} → processed locally, no data left your workspace.`,
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

async function sendAgentReply(
  roomId: string,
  agent: Participant,
  userText: string,
): Promise<void> {
  const meta = await getAgent(agent.id).catch(() => null);
  await roomsApi.broadcast(roomId, {
    from: agent.id,
    content: { type: 'text', body: pickReplyBody(meta, userText) },
  });
}

/**
 * Triggers simulated replies after the current user sends a message:
 * mentioned room agents reply; in a direct DM with an agent that agent
 * replies even without a mention; groups without mentions get no reply.
 * Returns a cancel function that stops all pending timers (used on unmount).
 */
export function maybeSimulateAgentReplies({
  roomId,
  text,
  agents,
  isDirectDM,
  onTypingChange,
}: SimulateAgentRepliesOptions): () => void {
  if (!SIMULATE_AGENT_REPLIES) return () => {};

  const mentioned = findMentionedAgents(text, agents);
  // Deliberate drift from the prototype: the prototype only auto-replies in a
  // DM when the agent is `online`, but presence does not exist in the
  // protocol, so this DM fallback replies unconditionally.
  const targets = mentioned.length > 0 ? mentioned : isDirectDM ? agents : [];
  if (targets.length === 0) return () => {};

  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  targets.forEach((agent, index) => {
    const typingAt = TYPING_DELAY_MS + index * STAGGER_MS;
    const stopTyping = () => {
      if (!cancelled) onTypingChange(agent, false);
    };

    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        onTypingChange(agent, true);

        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            sendAgentReply(roomId, agent, text)
              .catch(() => {
                // Simulation: a failed broadcast fails silently.
              })
              .finally(stopTyping);
          }, REPLY_DELAY_MS),
        );
        // Safety net: never leave a typing row stuck on screen.
        timers.push(setTimeout(stopTyping, TYPING_SAFETY_TIMEOUT_MS));
      }, typingAt),
    );
  });

  return () => {
    cancelled = true;
    for (const timer of timers) clearTimeout(timer);
  };
}
