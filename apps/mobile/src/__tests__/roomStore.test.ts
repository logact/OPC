import { useRoomStore } from '../stores/roomStore';
import type { ServerEvent } from '@opc/mqtt-client';

const mockHistory = jest.fn();
const mockReadState = jest.fn();

jest.mock('../api/http', () => ({
  roomsApi: {
    history: (...args: unknown[]) => mockHistory(...args),
    readState: (...args: unknown[]) => mockReadState(...args),
  },
}));

function resetStore() {
  useRoomStore.setState({
    rooms: [],
    currentRoomId: null,
    messages: [],
    lastMessages: {},
    readCursors: {},
    isLoadingRooms: false,
    isLoadingMessages: false,
    error: null,
  });
}

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
          createdAt: '2026-08-05T12:00:00.000Z',
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
    const { handleServerEvent } = useRoomStore.getState();
    const event: ServerEvent = {
      type: 'message.delivered',
      message: {
        id: 'm-1',
        roomId: 'room-1',
        from: 'alice',
        content: { type: 'text', body: 'hi' },
        createdAt: '2026-08-05T12:00:00.000Z',
      },
    };

    handleServerEvent(event);

    expect(useRoomStore.getState().messages).toHaveLength(1);
  });
});
