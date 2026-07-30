import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { ChatScreen } from '../screens/ChatScreen';

// Rendered components schedule React state updates; opt into act() semantics.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSendText = jest.fn();
const mockBroadcast = jest.fn();
const mockGetRoom = jest.fn();
const mockGetParticipant = jest.fn();
const mockSubscribePresence = jest.fn();

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

jest.mock('../contexts/MqttContext', () => ({
  useMqtt: () => ({
    client: { subscribePresence: (...args: unknown[]) => mockSubscribePresence(...args) },
    state: 'connected',
  }),
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
  mountedRenderers.push(renderer);
  return renderer;
}

// Renderers not explicitly unmounted by a test are torn down here: unmounting
// clears the FlatList's (VirtualizedList) pending _updateCellsToRender timers,
// which would otherwise fire after the test and fail the run with
// "Cannot log after tests are done".
const mountedRenderers: TestRenderer.ReactTestRenderer[] = [];

function unmountMountedRenderers() {
  for (const renderer of mountedRenderers.splice(0)) {
    act(() => {
      renderer.unmount();
    });
  }
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
    mockSubscribePresence.mockReturnValue(jest.fn());
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

describe('ChatScreen agent activity indicator (issue #83)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRoom.mockResolvedValue({ room: DM_ROOM });
    mockGetParticipant.mockImplementation(async (id: string) => ({
      participant: id === 'agent2' ? AGENT : ME,
    }));
    mockSubscribePresence.mockReturnValue(jest.fn());
  });

  afterEach(() => {
    unmountMountedRenderers();
  });

  function presenceListener() {
    return mockSubscribePresence.mock.calls[0]?.[0] as (
      id: string,
      presence: { online: boolean; status?: 'idle' | 'working' | 'blocking' | 'error' },
    ) => void;
  }

  // The indicator bar renders its copy in a single inner Text.
  function indicatorText(root: TestRenderer.ReactTestInstance): string {
    return findByTestId(root, 'agent-activity-indicator').findByType(Text).props
      .children as string;
  }

  it('shows nothing while the agent is idle or offline', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      presenceListener()('agent2', { online: true, status: 'idle' });
    });
    expect(renderer.root.findAllByProps({ testID: 'agent-activity-indicator' })).toHaveLength(0);

    await act(async () => {
      presenceListener()('agent2', { online: false });
    });
    expect(renderer.root.findAllByProps({ testID: 'agent-activity-indicator' })).toHaveLength(0);
  });

  it('shows a working line when the agent goes working', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      presenceListener()('agent2', { online: true, status: 'working' });
    });
    expect(indicatorText(renderer.root)).toBe('agent2 working…');
  });

  it('shows waiting-for-input on blocking and an error line on error', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      presenceListener()('agent2', { online: true, status: 'blocking' });
    });
    expect(indicatorText(renderer.root)).toBe('agent2 waiting for input');

    await act(async () => {
      presenceListener()('agent2', { online: true, status: 'error' });
    });
    expect(indicatorText(renderer.root)).toBe('agent2 error');
  });

  it('hides the indicator again when the agent returns to idle', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      presenceListener()('agent2', { online: true, status: 'working' });
    });
    expect(findByTestId(renderer.root, 'agent-activity-indicator')).toBeDefined();

    await act(async () => {
      presenceListener()('agent2', { online: true, status: 'idle' });
    });
    expect(renderer.root.findAllByProps({ testID: 'agent-activity-indicator' })).toHaveLength(0);
  });
});
