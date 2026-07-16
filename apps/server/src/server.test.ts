import { describe, expect, it, vi } from 'vitest';
import type { Message, Participant, Room } from '@logact-pub/opc-core';
import packageJson from '../package.json' with { type: 'json' };
import { createServer } from './server.js';

const mockRoomRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
};

const mockParticipantRepo = {
  ensure: vi.fn(),
  findById: vi.fn(),
  register: vi.fn(),
  verifyToken: vi.fn(),
  update: vi.fn(),
};

const mockMessageRepo = {
  insert: vi.fn(),
  findById: vi.fn(),
  findByRoomId: vi.fn(),
};

vi.mock('@opc/database', () => ({
  createDbClient: vi.fn(),
  createRoomRepository: vi.fn(() => mockRoomRepo),
  createParticipantRepository: vi.fn(() => mockParticipantRepo),
  createMessageRepository: vi.fn(() => mockMessageRepo),
}));

async function request(
  server: ReturnType<typeof createServer>,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  const { port } = server.address() as { port: number };
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function makeServer() {
  const server = createServer({
    db: {} as unknown as ReturnType<typeof import('@opc/database').createDbClient>,
    mqttSuperuser: { username: '__server__', password: 'secret' },
  });
  return new Promise<typeof server>((resolve) => server.listen(0, () => resolve(server)));
}

describe('createServer HTTP routes', () => {
  it('GET /api/v1/rooms/:id returns room details', async () => {
    const server = await makeServer();
    const room: Room = {
      id: 'room-1',
      name: 'general',
      participantIds: ['alice'],
      createdAt: new Date().toISOString(),
    };
    mockRoomRepo.findById.mockResolvedValue(room);

    const res = await request(server, 'GET', '/api/v1/rooms/room-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ room });
    server.close();
  });

  it('GET /api/v1/rooms/:id returns 404 for unknown room', async () => {
    const server = await makeServer();
    mockRoomRepo.findById.mockResolvedValue(undefined);

    const res = await request(server, 'GET', '/api/v1/rooms/unknown');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
    server.close();
  });

  it('PATCH /api/v1/rooms/:id updates room metadata', async () => {
    const server = await makeServer();
    const room: Room = {
      id: 'room-1',
      name: 'renamed',
      participantIds: ['alice'],
      createdAt: new Date().toISOString(),
      metadata: { topic: 'dev' },
    };
    mockRoomRepo.update.mockResolvedValue(room);

    const res = await request(server, 'PATCH', '/api/v1/rooms/room-1', { name: 'renamed', metadata: { topic: 'dev' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ room });
    expect(mockRoomRepo.update).toHaveBeenCalledWith('room-1', { name: 'renamed', metadata: { topic: 'dev' } });
    server.close();
  });

  it('GET /api/v1/participants/:id returns participant details', async () => {
    const server = await makeServer();
    const participant: Participant = { id: 'alice', kind: 'human', name: 'Alice' };
    mockParticipantRepo.findById.mockResolvedValue(participant);

    const res = await request(server, 'GET', '/api/v1/participants/alice');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ participant });
    server.close();
  });

  it('PATCH /api/v1/participants/:id updates participant kind', async () => {
    const server = await makeServer();
    const participant: Participant = { id: 'alice', kind: 'agent', name: 'Alice' };
    mockParticipantRepo.update.mockResolvedValue(participant);

    const res = await request(server, 'PATCH', '/api/v1/participants/alice', { kind: 'agent' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ participant });
    expect(mockParticipantRepo.update).toHaveBeenCalledWith('alice', { kind: 'agent' });
    server.close();
  });

  it('GET /api/v1/messages/:id returns message details', async () => {
    const server = await makeServer();
    const message: Message = {
      id: 'msg-1',
      roomId: 'room-1',
      from: 'alice',
      content: { type: 'text', body: 'hi' },
      timestamp: new Date().toISOString(),
    };
    mockMessageRepo.findById.mockResolvedValue(message);

    const res = await request(server, 'GET', '/api/v1/messages/msg-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message });
    server.close();
  });

  it('GET /openapi.json returns the OpenAPI spec', async () => {
    const server = await makeServer();

    const res = await request(server, 'GET', '/openapi.json');

    expect(res.status).toBe(200);
    const spec = res.body as Record<string, unknown>;
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info).toMatchObject({ title: 'OPC Server API', version: packageJson.version });
    expect(typeof spec.paths).toBe('object');
    expect(spec.paths).not.toBeNull();
    server.close();
  });

  it('GET /docs returns the Scalar API reference UI', async () => {
    const server = await makeServer();
    const { port } = server.address() as { port: number };

    const res = await fetch(`http://localhost:${port}/docs`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('scalar');
    expect(text).toContain('/scalar/api-reference.js');
    server.close();
  });

  it('GET /scalar/api-reference.js serves the local Scalar bundle', async () => {
    const server = await makeServer();
    const { port } = server.address() as { port: number };

    const res = await fetch(`http://localhost:${port}/scalar/api-reference.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const text = await res.text();
    expect(text.length).toBeGreaterThan(1000);
    server.close();
  });
});
