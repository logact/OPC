import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { API_ROUTES } from '@logact-pub/opc-protocol';
import type { Message, Participant, Room } from '@logact-pub/opc-protocol';
import packageJson from '../package.json' with { type: 'json' };
import { createServer } from './server.js';

const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long';

async function makeAccessToken(subject = 'test'): Promise<string> {
  return new SignJWT({ sub: subject })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

const mockRoomRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  addMembers: vi.fn(),
  findDirectRoom: vi.fn(),
};

const mockParticipantRepo = {
  ensure: vi.fn(),
  findById: vi.fn().mockImplementation((id: string) => ({ id, kind: 'human' })),
  register: vi.fn(),
  verifyPassword: vi.fn(),
  verifyToken: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
};

const mockMessageRepo = {
  insert: vi.fn(),
  findById: vi.fn(),
  findByRoomId: vi.fn(),
};

const mockOrganizationRepo = {
  hasOwner: vi.fn().mockResolvedValue(false),
  getOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  getTree: vi.fn(),
  listDepartments: vi.fn(),
  createDepartment: vi.fn(),
  getDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  listPositions: vi.fn(),
  createPosition: vi.fn(),
  getPosition: vi.fn(),
  updatePosition: vi.fn(),
  deletePosition: vi.fn(),
  listStaff: vi.fn(),
  getStaff: vi.fn().mockResolvedValue({
    participantId: 'test',
    isOwner: true,
    assignments: [],
    effectiveCapabilityGrants: [],
  }),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  assertParticipantKindChange: vi.fn(),
  reconcileParticipant: vi.fn(),
};

const mockAuthorizationAuditRepo = {
  append: vi.fn(),
  list: vi.fn(),
};

const mockTaskRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  getDetail: vi.fn(),
  list: vi.fn(),
  updateDraft: vi.fn(),
  recommend: vi.fn(),
  isCandidateEligible: vi.fn(),
  assign: vi.fn(),
  transition: vi.fn(),
  appendEvent: vi.fn(),
  departmentIsWithin: vi.fn(),
};

vi.mock('@opc/database', () => ({
  createDbClient: vi.fn(),
  createRoomRepository: vi.fn(() => mockRoomRepo),
  createParticipantRepository: vi.fn(() => mockParticipantRepo),
  createMessageRepository: vi.fn(() => mockMessageRepo),
  createOrganizationRepository: vi.fn(() => mockOrganizationRepo),
  createAuthorizationAuditRepository: vi.fn(() => mockAuthorizationAuditRepo),
  createTaskRepository: vi.fn(() => mockTaskRepo),
}));

async function request(
  server: ReturnType<typeof createServer>,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const { port } = server.address() as { port: number };
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function makeServer(options?: { eventPublisher?: { publish: (roomId: string, event: unknown) => void; publishGatewayCommand: (gatewayId: string, command: unknown) => void } }) {
  const server = createServer({
    db: {} as unknown as ReturnType<typeof import('@opc/database').createDbClient>,
    jwtSecret: TEST_JWT_SECRET,
    mqttSuperuser: { username: '__server__', password: 'secret' },
    eventPublisher: options?.eventPublisher,
  });
  return new Promise<typeof server>((resolve) => server.listen(0, () => resolve(server)));
}

describe('createServer HTTP routes', () => {
  it('GET /api/v1/rooms/:id returns room details', async () => {
    const server = await makeServer();
    const token = await makeAccessToken();
    const room: Room = {
      id: 'room-1',
      name: 'general',
      participantIds: ['alice'],
      creatorId: 'alice',
      type: 'group',
      departmentId: null,
      createdAt: new Date().toISOString(),
    };
    mockRoomRepo.findById.mockResolvedValue(room);

    const res = await request(server, 'GET', '/api/v1/rooms/room-1', undefined, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ room });
    server.close();
  });

  it('GET /api/v1/rooms/:id returns 404 for unknown room', async () => {
    const server = await makeServer();
    const token = await makeAccessToken();
    mockRoomRepo.findById.mockResolvedValue(undefined);

    const res = await request(server, 'GET', '/api/v1/rooms/unknown', undefined, token);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
    server.close();
  });

  it('PATCH /api/v1/rooms/:id updates room metadata', async () => {
    const server = await makeServer();
    const token = await makeAccessToken();
    const room: Room = {
      id: 'room-1',
      name: 'renamed',
      participantIds: ['alice'],
      creatorId: 'alice',
      type: 'group',
      departmentId: null,
      createdAt: new Date().toISOString(),
      metadata: { topic: 'dev' },
    };
    mockRoomRepo.findById.mockResolvedValue(room);
    mockRoomRepo.update.mockResolvedValue(room);

    const res = await request(server, 'PATCH', '/api/v1/rooms/room-1', { name: 'renamed', metadata: { topic: 'dev' } }, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ room });
    expect(mockRoomRepo.update).toHaveBeenCalledWith('room-1', { name: 'renamed', metadata: { topic: 'dev' } });
    server.close();
  });

  it('GET /api/v1/participants/:id returns participant details', async () => {
    const server = await makeServer();
    const token = await makeAccessToken();
    const participant: Participant = { id: 'alice', kind: 'human', name: 'Alice' };
    mockParticipantRepo.findById.mockResolvedValue(participant);

    const res = await request(server, 'GET', '/api/v1/participants/alice', undefined, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ participant });
    server.close();
  });

  it('PATCH /api/v1/participants/:id updates participant kind', async () => {
    const server = await makeServer();
    const token = await makeAccessToken();
    const participant: Participant = { id: 'alice', kind: 'agent', name: 'Alice' };
    mockParticipantRepo.update.mockResolvedValue(participant);

    const res = await request(server, 'PATCH', '/api/v1/participants/alice', { kind: 'agent' }, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ participant });
    expect(mockParticipantRepo.update).toHaveBeenCalledWith('alice', { kind: 'agent' });
    server.close();
  });

  it('GET /api/v1/messages/:id returns message details', async () => {
    const server = await makeServer();
    const token = await makeAccessToken();
    const message: Message = {
      id: 'msg-1',
      roomId: 'room-1',
      from: 'alice',
      content: { type: 'text', body: 'hi' },
      timestamp: new Date().toISOString(),
    };
    mockMessageRepo.findById.mockResolvedValue(message);
    mockRoomRepo.findById.mockResolvedValue({
      id: 'room-1',
      name: 'general',
      participantIds: ['alice'],
      creatorId: 'alice',
      type: 'group',
      departmentId: null,
      createdAt: new Date().toISOString(),
    });

    const res = await request(server, 'GET', '/api/v1/messages/msg-1', undefined, token);

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
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/v1/organization']).toBeDefined();
    expect(paths['/api/v1/organization/tree']).toBeDefined();
    const components = spec.components as { schemas?: Record<string, unknown> };
    expect(components.schemas?.DepartmentNode).toBeDefined();
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

  it('POST /api/v1/auth/login returns JWT for valid credentials', async () => {
    const server = await makeServer();
    mockParticipantRepo.verifyPassword.mockResolvedValue(true);
    mockParticipantRepo.findById.mockResolvedValue({ id: 'alice', kind: 'human', name: 'Alice' });

    const res = await request(server, 'POST', '/api/v1/auth/login', {
      username: 'alice',
      password: 'secret',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ participant: { id: 'alice' } });
    expect(typeof (res.body as { accessToken: string }).accessToken).toBe('string');
    server.close();
  });

  it('POST /api/v1/auth/login rejects invalid credentials', async () => {
    const server = await makeServer();
    mockParticipantRepo.verifyPassword.mockResolvedValue(false);

    const res = await request(server, 'POST', '/api/v1/auth/login', {
      username: 'alice',
      password: 'wrong',
    });

    expect(res.status).toBe(401);
    server.close();
  });

  it('returns 401 for protected endpoints without token', async () => {
    const server = await makeServer();

    const res = await request(server, 'GET', '/api/v1/rooms/room-1');

    expect(res.status).toBe(401);
    server.close();
  });

  it('POST /api/v1/participants remains public', async () => {
    const server = await makeServer();
    mockParticipantRepo.register.mockResolvedValue({
      participant: { id: 'bob', kind: 'human', name: 'Bob' },
      token: 'tok',
    });

    const res = await request(server, 'POST', '/api/v1/participants', {
      id: 'bob',
      password: 'secret123',
    });

    expect(res.status).toBe(201);
    expect(mockParticipantRepo.register).toHaveBeenCalledWith('bob', undefined, 'human', 'secret123', undefined);
    server.close();
  });

  it('POST /api/v1/participants with kind=agent triggers gateway spawn command', async () => {
    const publishGatewayCommand = vi.fn();
    const server = await makeServer({
      eventPublisher: { publish: vi.fn(), publishGatewayCommand },
    });
    mockParticipantRepo.findById.mockResolvedValue({ id: 'alice', kind: 'human' });
    mockOrganizationRepo.getStaff.mockResolvedValue({
      participantId: 'alice',
      isOwner: true,
      assignments: [],
      effectiveCapabilityGrants: [],
    });
    mockParticipantRepo.register.mockResolvedValue({
      participant: { id: 'lobe', kind: 'agent', name: 'lobe' },
      token: 'agent-tok',
    });
    const token = await makeAccessToken('alice');

    const res = await request(
      server,
      'POST',
      '/api/v1/participants',
      {
        id: 'lobe',
        kind: 'agent',
        gatewayId: 'gw-1',
      },
      token
    );

    expect(res.status).toBe(201);
    expect(mockParticipantRepo.register).toHaveBeenCalledWith('lobe', undefined, 'agent', undefined, 'gw-1');
    // gateway 单连接多路复用后 agent 无需独立 MQTT 凭据，spawn 命令不再下发 token
    expect(publishGatewayCommand).toHaveBeenCalledWith('gw-1', {
      type: 'agent.spawn',
      participantId: 'lobe',
      name: undefined,
      model: undefined,
    });
    server.close();
  });

  describe('MQTT ACL', () => {
    async function checkAcl(
      server: ReturnType<typeof createServer>,
      body: { username: string; topic: string; acc: number }
    ): Promise<number> {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://localhost:${port}${API_ROUTES.auth.mqttAcl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.status;
    }

    it('allows gateway to subscribe its own control topic', async () => {
      const server = await makeServer();
      const statuses = await Promise.all([
        checkAcl(server, { username: 'gw-1', topic: 'opc/gateways/gw-1/control', acc: 1 }),
        checkAcl(server, { username: 'gw-1', topic: 'opc/gateways/gw-1/control', acc: 4 }),
        checkAcl(server, { username: 'gw-1', topic: 'opc/gateways/gw-1/control', acc: 3 }),
      ]);
      expect(statuses).toEqual([200, 200, 200]);
      server.close();
    });

    it('denies control topic for other usernames or write', async () => {
      const server = await makeServer();
      const statuses = await Promise.all([
        checkAcl(server, { username: 'gw-2', topic: 'opc/gateways/gw-1/control', acc: 1 }),
        checkAcl(server, { username: 'gw-1', topic: 'opc/gateways/gw-1/control', acc: 2 }),
      ]);
      expect(statuses).toEqual([403, 403]);
      server.close();
    });
  });
});
