import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ChatScreen } from '../screens/ChatScreen';

// Rendered components schedule React state updates; opt into act() semantics.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSendText = jest.fn();
const mockBroadcast = jest.fn();
const mockGetRoom = jest.fn();
const mockGetParticipant = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { roomId: 'room1', roomName: 'agent2' } }),
}));

jest.mock('../api/http', () => ({
  roomsApi: {
    get: (...args: unknown[]) => mockGetRoom(...args),
    broadcast: (...args: unknown[]) => mockBroadcast(...args),
  },
  participantsApi: {
    get: (...args: unknown[]) => mockGetParticipant(...args),
  },
}));

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ participantId: 'me', token: 'my-token' }),
}));

// Stable identities: ChatScreen's effects depend on enterRoom/leaveRoom, so the
// mock must not hand back new functions on every render.
const mockEnterRoom = jest.fn();
const mockLeaveRoom = jest.fn();
jest.mock('../hooks/useRoom', () => ({
  useRoom: () => ({
    messages: [],
    isLoadingMessages: false,
    enterRoom: mockEnterRoom,
    leaveRoom: mockLeaveRoom,
    sendText: (...args: unknown[]) => mockSendText(...args),
  }),
}));

// Direct DM between the current user and one agent.
const DM_ROOM = {
  id: 'room1',
  participantIds: ['me', 'agent2'],
  metadata: { type: 'direct' },
};
const AGENT = { id: 'agent2', name: 'agent2', kind: 'agent' as const };
const ME = { id: 'me', name: 'me', kind: 'human' as const };

function findByTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatScreen />);
  });
  return renderer;
}

async function sendMessage(renderer: TestRenderer.ReactTestRenderer, text: string) {
  await act(async () => {
    findByTestId(renderer.root, 'room-input').props.onChangeText(text);
  });
  await act(async () => {
    findByTestId(renderer.root, 'room-send-btn').props.onPress();
  });
}

describe('ChatScreen agent replies (issue #79)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetRoom.mockResolvedValue({ room: DM_ROOM });
    mockGetParticipant.mockImplementation(async (id: string) => ({
      participant: id === 'agent2' ? AGENT : ME,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not broadcast a fake agent reply after the user sends a message', async () => {
    const renderer = await renderScreen();
    await sendMessage(renderer, 'hello');

    expect(mockSendText).toHaveBeenCalledWith('room1', 'hello');

    // Run past every simulation timer (typing + reply + safety timeout).
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('does not show a typing indicator after the user sends a message', async () => {
    const renderer = await renderScreen();
    await sendMessage(renderer, 'hello');

    // Past the point where a simulated reply would start "typing" (~700ms).
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(renderer.root.findAllByProps({ testID: 'typing-indicator' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'typing-row-agent2' })).toHaveLength(0);
  });
});
