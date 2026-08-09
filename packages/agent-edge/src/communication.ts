/**
 * Agent communication tools (issue #11).
 *
 * The edge runtime deliberately owns only a small transport-neutral contract.
 * A host such as @opc/agent-gateway supplies the HTTP/MQTT implementation for
 * its managed agent, keeping the runtime usable without a network dependency.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';

/** Transport operations required for an agent to start and use OPC chats. */
export interface AgentCommunication {
  /** Create or reuse a 1:1 room between the owning agent and this participant. */
  createDirectRoom(participantId: string): Promise<string>;
  /** Create a group room. The owning agent is always added by the server. */
  createGroupRoom(name: string, participantIds: string[]): Promise<string>;
  /** Send a text message as the owning agent to an existing room. */
  sendMessage(roomId: string, body: string): Promise<void>;
}

export const COMMUNICATION_TOOL_NAMES = [
  'create_direct_room',
  'create_group_room',
  'send_room_message',
] as const;

export type CommunicationToolName = (typeof COMMUNICATION_TOOL_NAMES)[number];

const DIRECT_ROOM_PARAMETERS = Type.Object({
  participantId: Type.String({
    minLength: 1,
    description: 'The human or agent participant id to chat with.',
  }),
});

const GROUP_ROOM_PARAMETERS = Type.Object({
  name: Type.String({ minLength: 1, description: 'A short name for the group chat.' }),
  participantIds: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description:
      'Participant ids to invite. The owning agent is added automatically and need not be included.',
  }),
});

const SEND_MESSAGE_PARAMETERS = Type.Object({
  roomId: Type.String({ minLength: 1, description: 'The target OPC room id.' }),
  body: Type.String({ minLength: 1, description: 'The text message to send.' }),
});

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Communication request failed: ${message}` }],
    details: { error: message },
    isError: true,
  };
}

/**
 * Builds the always-available chat tool set for one agent runtime.
 * Authorization is intentionally delegated to the supplied transport and the
 * OPC server; a tool does not bypass room-create or room-membership policy.
 */
export function createCommunicationTools(communication: AgentCommunication): AgentTool[] {
  const createDirectRoom: AgentTool = {
    name: 'create_direct_room',
    label: 'Create direct room',
    description:
      'Create or reuse a private one-to-one chat with a human or another agent. The current agent is included automatically.',
    parameters: DIRECT_ROOM_PARAMETERS,
    execute: async (_toolCallId, args) => {
      try {
        const { participantId } = args as { participantId: string };
        const roomId = await communication.createDirectRoom(participantId);
        return {
          content: [{ type: 'text' as const, text: `Direct room ready: ${roomId}` }],
          details: { roomId },
        };
      } catch (error) {
        return failure(error);
      }
    },
  };

  const createGroupRoom: AgentTool = {
    name: 'create_group_room',
    label: 'Create group room',
    description:
      'Create a group chat with one or more human or agent participant ids. The current agent is included automatically.',
    parameters: GROUP_ROOM_PARAMETERS,
    execute: async (_toolCallId, args) => {
      try {
        const { name, participantIds } = args as { name: string; participantIds: string[] };
        const roomId = await communication.createGroupRoom(name, participantIds);
        return {
          content: [{ type: 'text' as const, text: `Group room ready: ${roomId}` }],
          details: { roomId },
        };
      } catch (error) {
        return failure(error);
      }
    },
  };

  const sendRoomMessage: AgentTool = {
    name: 'send_room_message',
    label: 'Send room message',
    description: 'Send a text message to an OPC room as the current agent.',
    parameters: SEND_MESSAGE_PARAMETERS,
    execute: async (_toolCallId, args) => {
      try {
        const { roomId, body } = args as { roomId: string; body: string };
        await communication.sendMessage(roomId, body);
        return {
          content: [{ type: 'text' as const, text: `Message sent to room ${roomId}.` }],
          details: { roomId },
        };
      } catch (error) {
        return failure(error);
      }
    },
  };

  return [createDirectRoom, createGroupRoom, sendRoomMessage];
}
