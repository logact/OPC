import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { API_ROUTES, MQTT_ACL, parseRoomTopic } from '@opc/protocol';
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  ListRoomsResponse,
  MqttAuthAclRequest,
  MqttAuthUserRequest,
  RegisterParticipantRequest,
  RegisterParticipantResponse,
  RoomHistoryResponse,
} from '@opc/protocol';
import {
  createDbClient,
  createRoomRepository,
  createParticipantRepository,
  createMessageRepository,
} from '@opc/database';

export type { DbClient } from '@opc/database';

export interface MqttSuperuser {
  username: string;
  password: string;
}

export interface ServerOptions {
  db: ReturnType<typeof createDbClient>;
  /** mqtt-bridge 的连接身份；broker 回调 superuser/user 检查时据此判定 */
  mqttSuperuser: MqttSuperuser;
}

export function createServer({ db, mqttSuperuser }: ServerOptions): HttpServer {
  const roomRepo = createRoomRepository(db);
  const participantRepo = createParticipantRepository(db);
  const messageRepo = createMessageRepository(db);

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  return createHttpServer((req, res) => void handleRequest(req, res));

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    try {
      if (req.method === 'POST' && url.pathname === API_ROUTES.rooms) {
        const payload = (await readJsonBody(req)) as CreateRoomRequest;
        const participantIds = payload.participantIds ?? [];
        // participant 按需创建，避免 room_members 外键违反
        for (const participantId of participantIds) {
          await participantRepo.ensure(participantId);
        }
        const room = await roomRepo.create(payload.name, participantIds);
        json(res, 201, { roomId: room.id } satisfies CreateRoomResponse);
        return;
      }

      if (req.method === 'GET' && url.pathname === API_ROUTES.rooms) {
        const roomList = await roomRepo.list();
        json(res, 200, { rooms: roomList } satisfies ListRoomsResponse);
        return;
      }

      if (
        req.method === 'GET' &&
        url.pathname.startsWith('/api/v1/rooms/') &&
        url.pathname.endsWith('/history')
      ) {
        const roomId = url.pathname.split('/')[4];
        const messages = await messageRepo.findByRoomId(roomId);
        json(res, 200, { messages } satisfies RoomHistoryResponse);
        return;
      }

      if (req.method === 'POST' && url.pathname === API_ROUTES.participants) {
        const payload = (await readJsonBody(req)) as RegisterParticipantRequest;
        if (typeof payload?.id !== 'string' || payload.id.length === 0) {
          json(res, 400, { error: 'id is required' });
          return;
        }
        const { participant, token } = await participantRepo.register(payload.id, payload.name);
        json(res, 201, { participantId: participant.id, token } satisfies RegisterParticipantResponse);
        return;
      }

      // ---- mosquitto-go-auth HTTP 后端回调 ----

      if (req.method === 'POST' && url.pathname === API_ROUTES.auth.mqttUser) {
        const { username, password } = (await readJsonBody(req)) as MqttAuthUserRequest;
        const ok =
          username === mqttSuperuser.username
            ? password === mqttSuperuser.password
            : await participantRepo.verifyToken(username, password);
        json(res, ok ? 200 : 403, {});
        return;
      }

      if (req.method === 'POST' && url.pathname === API_ROUTES.auth.mqttSuperuser) {
        const { username } = (await readJsonBody(req)) as MqttAuthUserRequest;
        json(res, username === mqttSuperuser.username ? 200 : 403, {});
        return;
      }

      if (req.method === 'POST' && url.pathname === API_ROUTES.auth.mqttAcl) {
        const { username, topic, acc } = (await readJsonBody(req)) as MqttAuthAclRequest;
        const allowed = await checkAcl(username, topic, acc);
        json(res, allowed ? 200 : 403, {});
        return;
      }

      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'unknown error' });
    }
  }

  async function checkAcl(username: string, topic: string, acc: number): Promise<boolean> {
    const parsed = parseRoomTopic(topic);
    // OPC 命名空间之外的 topic 一律拒绝
    if (!parsed) return false;

    const directionOk =
      parsed.direction === 'uplink'
        ? acc === MQTT_ACL.WRITE || acc === MQTT_ACL.READWRITE
        : acc === MQTT_ACL.READ || acc === MQTT_ACL.SUBSCRIBE || acc === MQTT_ACL.READWRITE;
    if (!directionOk) return false;

    const room = await roomRepo.findById(parsed.roomId);
    return room?.participantIds.includes(username) ?? false;
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', reject);
  });
}
