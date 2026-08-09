import type { Message } from '@opc/api-client';
import type { ServerEvent } from '@opc/mqtt-client';
import { useRoomStore } from '../stores/roomStore';

const mockHistory = jest.fn();
const mockReadState = jest.fn();
const mockListForParticipant = jest.fn();

jest.mock('../api/http', () => ({
  roomsApi: {
    listForParticipant: (...args: unknown[]) => mockListForParticipant(...args),
    history: (...args: unknown[]) => mockHistory(...args),
    readState: (...args: unknown[]) => mockReadState(...args),
  },
}));

function message(id: string, timestamp: string): Message {
  return {
    id,
    roomId: 'room1',
    from: 'someone',
    content: { type: 'text', body: `body-${id}` },
    timestamp,
  };
}

function room(id = 'room1', unreadCount = 0) {
  return {
    id,
    name: 'Room',
    participantIds: ['me', 'someone'],
    creatorId: 'me',
    type: 'group' as const,
    departmentId: null,
    createdAt: '2026-08-05T09:00:00.000Z',
    unreadCount,
    lastMessage: null,
  };
}

// Server history is newest-first (desc by timestamp).
const HISTORY = [
  message('m3', '2026-08-05T12:00:00.000Z'),
  message('m2', '2026-08-05T11:00:00.000Z'),
  message('m1', '2026-08-05T10:00:00.000Z'),
];

function resetStore() {
  useRoomStore.setState({
    rooms: [],
    participantId: null,
    currentRoomId: null,
    messages: [],
    readCursors: {},
    isLoadingRooms: false,
    isLoadingMessages: false,
    error: null,
  });
}

describe('roomStore message ordering (issue #128)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
    mockHistory.mockResolvedValue({ messages: HISTORY });
    mockReadState.mockResolvedValue({ reads: [] });
  });

  it('stores history oldest-first so the latest message renders at the bottom', async () => {
    await useRoomStore.getState().enterRoom('room1');

    expect(useRoomStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('still seeds the conversation preview with the latest message', async () => {
    useRoomStore.setState({ rooms: [room()] });
    await useRoomStore.getState().enterRoom('room1');

    expect(useRoomStore.getState().rooms[0].lastMessage?.id).toBe('m3');
  });

  it('appends a live message after the history tail and updates its preview', async () => {
    useRoomStore.setState({ rooms: [room()], participantId: 'me' });
    await useRoomStore.getState().enterRoom('room1');

    useRoomStore.getState().handleServerEvent({
      type: 'message.delivered',
      message: message('m4', '2026-08-05T13:00:00.000Z'),
    });

    expect(useRoomStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(useRoomStore.getState().rooms[0].lastMessage?.id).toBe('m4');
  });

  it('keeps a live message that arrives while history is loading', async () => {
    useRoomStore.setState({ rooms: [room()], participantId: 'me' });
    let resolveHistory: ((value: { messages: Message[] }) => void) | undefined;
    mockHistory.mockImplementation(
      () =>
        new Promise<{ messages: Message[] }>((resolve) => {
          resolveHistory = resolve;
        }),
    );

    const entering = useRoomStore.getState().enterRoom('room1');
    useRoomStore.getState().handleServerEvent({
      type: 'message.delivered',
      message: message('m4', '2026-08-05T13:00:00.000Z'),
    });
    resolveHistory?.({ messages: HISTORY });
    await entering;

    expect(useRoomStore.getState().messages.map((item) => item.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  });
});

describe('roomStore unread conversation state (issue #96)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
  });

  it('loads membership-scoped rooms instead of the global room directory', async () => {
    mockListForParticipant.mockResolvedValue({ rooms: [room('room-1', 2)] });

    await useRoomStore.getState().loadRooms('me');

    expect(mockListForParticipant).toHaveBeenCalledWith('me');
    expect(useRoomStore.getState().rooms).toEqual([room('room-1', 2)]);
    expect(useRoomStore.getState().participantId).toBe('me');
  });

  it('updates a background-room preview and unread count for a new incoming message', () => {
    useRoomStore.setState({ rooms: [room('room-1', 2)], participantId: 'me' });

    useRoomStore.getState().handleServerEvent({
      type: 'message.delivered',
      message: {
        id: 'm-new',
        roomId: 'room-1',
        from: 'someone',
        content: { type: 'text', body: 'New message' },
        timestamp: '2026-08-05T14:00:00.000Z',
      },
    });

    expect(useRoomStore.getState().messages).toEqual([]);
    expect(useRoomStore.getState().rooms[0]).toMatchObject({
      unreadCount: 3,
      lastMessage: { id: 'm-new', content: { body: 'New message' } },
    });
  });

  it('does not increment unread for the current room, own messages, or broker duplicates', () => {
    useRoomStore.setState({
      rooms: [room('room-1', 1)],
      participantId: 'me',
      currentRoomId: 'room-1',
    });
    const incoming: ServerEvent = {
      type: 'message.delivered',
      message: {
        id: 'm-new',
        roomId: 'room-1',
        from: 'someone',
        content: { type: 'text', body: 'New message' },
        timestamp: '2026-08-05T14:00:00.000Z',
      },
    };

    useRoomStore.getState().handleServerEvent(incoming);
    useRoomStore.getState().handleServerEvent(incoming);
    useRoomStore.getState().handleServerEvent({
      type: 'message.delivered',
      message: { ...incoming.message, id: 'm-own', from: 'me', timestamp: '2026-08-05T15:00:00.000Z' },
    });

    expect(useRoomStore.getState().rooms[0].unreadCount).toBe(0);
    expect(useRoomStore.getState().messages.map((item) => item.id)).toEqual(['m-new', 'm-own']);
  });

  it('clears the local unread count on room entry before the durable receipt returns', async () => {
    useRoomStore.setState({ rooms: [room('room-1', 4)], participantId: 'me' });
    mockHistory.mockResolvedValue({ messages: [] });
    mockReadState.mockResolvedValue({ reads: [] });

    await useRoomStore.getState().enterRoom('room-1');

    expect(useRoomStore.getState().rooms[0].unreadCount).toBe(0);
  });
});

describe('roomStore read cursors (issue #108)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
  });

  it('loads read cursors on enterRoom', async () => {
    mockHistory.mockResolvedValue({ messages: [] });
    mockReadState.mockResolvedValue({
      reads: [
        { participantId: 'alice', lastReadAt: '2026-08-05T12:00:00.000Z' },
        { participantId: 'bob', lastReadAt: null },
      ],
    });

    await useRoomStore.getState().enterRoom('room-1');

    expect(mockReadState).toHaveBeenCalledWith('room-1');
    expect(useRoomStore.getState().readCursors['room-1']).toEqual({
      alice: '2026-08-05T12:00:00.000Z',
      bob: null,
    });
  });

  it('still loads messages when the read-state request fails', async () => {
    mockHistory.mockResolvedValue({
      messages: [
        {
          id: 'm-1',
          roomId: 'room-1',
          from: 'alice',
          content: { type: 'text', body: 'hi' },
          timestamp: '2026-08-05T12:00:00.000Z',
        },
      ],
    });
    mockReadState.mockRejectedValue(new Error('boom'));

    await useRoomStore.getState().enterRoom('room-1');

    expect(useRoomStore.getState().messages).toHaveLength(1);
    expect(useRoomStore.getState().error).toBeNull();
    expect(useRoomStore.getState().readCursors).toEqual({});
  });

  it('merges read.updated events monotonically', () => {
    const { handleServerEvent } = useRoomStore.getState();

    handleServerEvent({
      type: 'read.updated',
      roomId: 'room-1',
      participantId: 'alice',
      lastReadAt: '2026-08-05T12:00:00.000Z',
    });
    expect(useRoomStore.getState().readCursors['room-1'].alice).toBe(
      '2026-08-05T12:00:00.000Z',
    );

    // 更新的回执推进游标
    handleServerEvent({
      type: 'read.updated',
      roomId: 'room-1',
      participantId: 'alice',
      lastReadAt: '2026-08-05T13:00:00.000Z',
    });
    expect(useRoomStore.getState().readCursors['room-1'].alice).toBe(
      '2026-08-05T13:00:00.000Z',
    );

    // 更旧的回执不回退游标
    handleServerEvent({
      type: 'read.updated',
      roomId: 'room-1',
      participantId: 'alice',
      lastReadAt: '2026-08-05T11:00:00.000Z',
    });
    expect(useRoomStore.getState().readCursors['room-1'].alice).toBe(
      '2026-08-05T13:00:00.000Z',
    );
  });

  it('keeps read cursors of different rooms separate', () => {
    const { handleServerEvent } = useRoomStore.getState();

    handleServerEvent({
      type: 'read.updated',
      roomId: 'room-1',
      participantId: 'alice',
      lastReadAt: '2026-08-05T12:00:00.000Z',
    });
    handleServerEvent({
      type: 'read.updated',
      roomId: 'room-2',
      participantId: 'alice',
      lastReadAt: '2026-08-05T09:00:00.000Z',
    });

    expect(useRoomStore.getState().readCursors['room-1'].alice).toBe(
      '2026-08-05T12:00:00.000Z',
    );
    expect(useRoomStore.getState().readCursors['room-2'].alice).toBe(
      '2026-08-05T09:00:00.000Z',
    );
  });

  it('still appends message.delivered events', () => {
    useRoomStore.setState({ rooms: [room('room-1')], currentRoomId: 'room-1' });
    const { handleServerEvent } = useRoomStore.getState();
    const event: ServerEvent = {
      type: 'message.delivered',
      message: {
        id: 'm-1',
        roomId: 'room-1',
        from: 'alice',
        content: { type: 'text', body: 'hi' },
        timestamp: '2026-08-05T12:00:00.000Z',
      },
    };

    handleServerEvent(event);

    expect(useRoomStore.getState().messages).toHaveLength(1);
  });
});
