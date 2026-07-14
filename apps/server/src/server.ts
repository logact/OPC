import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { API_ROUTES, type ServerFrame } from '@opc/protocol';
import type { ClientFrame, CreateRoomRequest, CreateRoomResponse, ListRoomsResponse, RoomHistoryResponse } from '@opc/protocol';
import type { Message, ServerEvent } from '@opc/core';
import { createTextMessage } from '@opc/core';
import {
  createDbClient,
  createRoomRepository,
  createParticipantRepository,
  createMessageRepository,
} from '@opc/database';
import { SessionManager } from './session.js';

export type { DbClient } from '@opc/database';

export interface ServerOptions {
  db: ReturnType<typeof createDbClient>;
}

export function createServer({ db }: ServerOptions): HttpServer {
  const sessions = new SessionManager();
  const roomRepo = createRoomRepository(db);
  const participantRepo = createParticipantRepository(db);
  const messageRepo = createMessageRepository(db);

  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === API_ROUTES.rooms) {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => void handleCreateRoom());

      async function handleCreateRoom() {
        try {
          const payload = JSON.parse(body) as CreateRoomRequest;
          const participantIds = payload.participantIds ?? [];
          // 与 WS auth 路径一致：participant 按需创建，避免 room_members 外键违反
          for (const participantId of participantIds) {
            await participantRepo.ensure(participantId);
          }
          const room = await roomRepo.create(payload.name, participantIds);
          json(201, { roomId: room.id } satisfies CreateRoomResponse);
        } catch (err) {
          json(500, { error: err instanceof Error ? err.message : 'unknown error' });
        }
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === API_ROUTES.rooms) {
      roomRepo
        .list()
        .then((roomList) => json(200, { rooms: roomList } satisfies ListRoomsResponse))
        .catch((err) => json(500, { error: err instanceof Error ? err.message : 'unknown error' }));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/rooms/') && url.pathname.endsWith('/history')) {
      const roomId = url.pathname.split('/')[4];
      messageRepo
        .findByRoomId(roomId)
        .then((messages) => json(200, { messages } satisfies RoomHistoryResponse))
        .catch((err) => json(500, { error: err instanceof Error ? err.message : 'unknown error' }));
      return;
    }

    json(404, { error: 'not found' });
  });

  const wss = new WebSocketServer({ server: httpServer, path: API_ROUTES.ws });

  wss.on('connection', (socket) => {
    let participantId: string | undefined;

    socket.on('message', (raw) => void handleMessage(raw));

    async function handleMessage(raw: Buffer | ArrayBuffer | Buffer[]) {
      try {
        const text = Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : Buffer.isBuffer(raw)
            ? raw.toString('utf8')
            : Buffer.from(raw).toString('utf8');
        const frame = JSON.parse(text) as ClientFrame;

        if (frame.type === 'auth') {
          participantId = validateToken(frame.token);
          await participantRepo.ensure(participantId);
          sessions.register(participantId, socket);
          send(socket, { type: 'authenticated', participantId });
          return;
        }

        if (!participantId) {
          send(socket, { type: 'error', code: 'UNAUTHENTICATED', message: 'auth first' });
          return;
        }

        switch (frame.type) {
          case 'room.subscribe': {
            sessions.subscribe(participantId, frame.roomId);
            break;
          }
          case 'room.unsubscribe': {
            sessions.unsubscribe(participantId, frame.roomId);
            break;
          }
          case 'message.send': {
            const room = await roomRepo.findById(frame.roomId);
            if (!room) {
              send(socket, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'room not found' });
              return;
            }

            const message: Message = createTextMessage(
              randomUUID(),
              frame.roomId,
              participantId,
              frame.content.type === 'text' ? frame.content.body : JSON.stringify(frame.content.body)
            );

            await messageRepo.insert(frame.roomId, message);
            broadcast(sessions, room, { type: 'message.delivered', message });
            break;
          }
          case 'ping': {
            send(socket, { type: 'pong', ts: frame.ts });
            break;
          }
        }
      } catch (err) {
        send(socket, {
          type: 'error',
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    socket.on('close', () => {
      if (participantId) sessions.unregister(participantId);
    });
  });

  return httpServer;
}

function send(socket: import('ws').WebSocket, frame: ServerFrame): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(frame));
  }
}

function broadcast(sessions: SessionManager, room: { participantIds: string[] }, event: ServerEvent): void {
  for (const participantId of room.participantIds) {
    sessions.deliver(participantId, event);
  }
}

function validateToken(token: string): string {
  // TODO: JWT 或真实鉴权；当前 token 即 participantId
  return token;
}
