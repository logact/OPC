const mockHistory = jest.fn();

jest.mock('../api/http', () => ({
  roomsApi: {
    list: jest.fn(),
    history: (...args: unknown[]) => mockHistory(...args),
  },
}));

import type { Message } from '@opc/api-client';
import { useRoomStore } from '../stores/roomStore';

function message(id: string, timestamp: string): Message {
  return {
    id,
    roomId: 'room1',
    from: 'someone',
    content: { type: 'text', body: `body-${id}` },
    timestamp,
  };
}

// Server history is newest-first (desc by timestamp).
const HISTORY = [
  message('m3', '2026-08-05T12:00:00.000Z'),
  message('m2', '2026-08-05T11:00:00.000Z'),
  message('m1', '2026-08-05T10:00:00.000Z'),
];

describe('roomStore message ordering (issue #128)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRoomStore.setState({
      rooms: [],
      currentRoomId: null,
      messages: [],
      lastMessages: {},
      isLoadingRooms: false,
      isLoadingMessages: false,
      error: null,
    });
    mockHistory.mockResolvedValue({ messages: HISTORY });
  });

  it('stores history oldest-first so the latest message renders at the bottom', async () => {
    await useRoomStore.getState().enterRoom('room1');

    expect(useRoomStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('still seeds the conversation preview with the latest message', async () => {
    await useRoomStore.getState().enterRoom('room1');

    expect(useRoomStore.getState().lastMessages.room1?.id).toBe('m3');
  });

  it('appends a live message after the history tail (newest stays last)', async () => {
    await useRoomStore.getState().enterRoom('room1');

    useRoomStore.getState().appendMessage(message('m4', '2026-08-05T13:00:00.000Z'));

    expect(useRoomStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(useRoomStore.getState().lastMessages.room1?.id).toBe('m4');
  });
});
