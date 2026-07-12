import type WebSocket from 'ws';
import type { ServerEvent } from '@opc/core';

export class SessionManager {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly subscriptions = new Map<string, Set<string>>(); // participantId -> roomIds

  register(participantId: string, socket: WebSocket): void {
    this.sockets.set(participantId, socket);
  }

  unregister(participantId: string): void {
    this.sockets.delete(participantId);
    this.subscriptions.delete(participantId);
  }

  subscribe(participantId: string, roomId: string): void {
    let set = this.subscriptions.get(participantId);
    if (!set) {
      set = new Set();
      this.subscriptions.set(participantId, set);
    }
    set.add(roomId);
  }

  unsubscribe(participantId: string, roomId: string): void {
    this.subscriptions.get(participantId)?.delete(roomId);
  }

  deliver(participantId: string, event: ServerEvent): void {
    // 只投递给实际订阅了该房间的 participant
    const subscribedRooms = this.subscriptions.get(participantId);
    if (!subscribedRooms) return;

    const roomId = 'roomId' in event ? event.roomId : 'message' in event ? event.message.roomId : undefined;
    if (roomId && !subscribedRooms.has(roomId)) return;

    const socket = this.sockets.get(participantId);
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify({ type: 'event', event }));
    }
  }
}
