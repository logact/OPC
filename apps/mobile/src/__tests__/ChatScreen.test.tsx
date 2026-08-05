import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatScreen } from '../screens/ChatScreen';

// Rendered components schedule React state updates; opt into act() semantics.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSendText = jest.fn();
const mockBroadcast = jest.fn();
const mockGetRoom = jest.fn();
const mockGetParticipant = jest.fn();
const mockSubscribePresence = jest.fn();
const mockCreateTask = jest.fn();
const mockGetTask = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: (...args: unknown[]) => mockNavigate(...args) }),
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
  tasksApi: {
    create: (...args: unknown[]) => mockCreateTask(...args),
    get: (...args: unknown[]) => mockGetTask(...args),
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
// Mutable message list: tests for the task card (issue #129) inject messages here.
let mockMessages: unknown[] = [];
jest.mock('../hooks/useRoom', () => ({
  useRoom: () => ({
    messages: mockMessages,
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <ChatScreen />
      </QueryClientProvider>,
    );
  });
  mountedRenderers.push(renderer);
  return renderer;
}

// Renderers not explicitly unmounted by a test are torn down here: unmounting
// clears the FlatList's (VirtualizedList) pending _updateCellsToRender timers,
// which would otherwise fire after the test and fail the run with
// "Cannot log after tests are done".
const mountedRenderers: TestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  mockMessages = [];
});

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

    // Default intent is 'question' (issue #104).
    expect(mockSendText).toHaveBeenCalledWith('room1', 'hello', 'question');

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

describe('ChatScreen message intent toggle (issue #104)', () => {
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

  it('renders a Task/Question toggle in the input bar', async () => {
    const renderer = await renderScreen();

    const toggle = findByTestId(renderer.root, 'room-intent-toggle');
    expect(toggle).toBeDefined();
    expect(typeof toggle.props.onPress).toBe('function');
  });

  it('sends with intent "question" when the toggle is left at its default', async () => {
    const renderer = await renderScreen();
    await sendMessage(renderer, 'hello');

    expect(mockSendText).toHaveBeenCalledWith('room1', 'hello', 'question');
  });

  it('sends with intent "task" after tapping the toggle when the room has no agent', async () => {
    // No agent in the room → task mode keeps the legacy plain-message behavior.
    mockGetParticipant.mockImplementation(async () => ({ participant: ME }));
    const renderer = await renderScreen();

    await act(async () => {
      findByTestId(renderer.root, 'room-intent-toggle').props.onPress();
    });
    await sendMessage(renderer, 'refactor this module');

    expect(mockSendText).toHaveBeenCalledWith('room1', 'refactor this module', 'task');
    expect(mockCreateTask).not.toHaveBeenCalled();
  });
});

describe('ChatScreen task creation (issue #129)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRoom.mockResolvedValue({ room: DM_ROOM });
    mockGetParticipant.mockImplementation(async (id: string) => ({
      participant: id === 'agent2' ? AGENT : ME,
    }));
    mockSubscribePresence.mockReturnValue(jest.fn());
    mockCreateTask.mockResolvedValue({ task: { id: 'task-1' } });
  });

  afterEach(() => {
    unmountMountedRenderers();
  });

  async function selectTaskIntent(renderer: TestRenderer.ReactTestRenderer) {
    await act(async () => {
      findByTestId(renderer.root, 'room-intent-toggle').props.onPress();
    });
  }

  it('creates an assigned task via the tasks API instead of sending a message', async () => {
    const renderer = await renderScreen();
    await selectTaskIntent(renderer);
    await sendMessage(renderer, 'Fix the login bug\nIt breaks on empty passwords');

    expect(mockCreateTask).toHaveBeenCalledWith({
      title: 'Fix the login bug',
      description: 'Fix the login bug\nIt breaks on empty passwords',
      assigneeId: 'agent2',
      originRoomId: 'room1',
    });
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('truncates an over-long single-line title', async () => {
    const renderer = await renderScreen();
    await selectTaskIntent(renderer);
    const longLine = 'x'.repeat(100);
    await sendMessage(renderer, longLine);

    const payload = mockCreateTask.mock.calls[0][0] as { title: string };
    expect(payload.title).toHaveLength(81);
    expect(payload.title.endsWith('…')).toBe(true);
    expect(payload.title).toBe(`${'x'.repeat(80)}…`);
  });

  it('restores the draft and shows an error bar when task creation fails', async () => {
    mockCreateTask.mockRejectedValue(new Error('boom'));
    const renderer = await renderScreen();
    await selectTaskIntent(renderer);
    await sendMessage(renderer, 'do the thing');

    expect(findByTestId(renderer.root, 'room-send-error')).toBeDefined();
    expect(findByTestId(renderer.root, 'room-input').props.value).toBe('do the thing');
  });

  it('renders a task reference message as a card linking to the task detail', async () => {
    mockGetTask.mockResolvedValue({
      task: {
        id: 'task-9',
        title: 'Fix the login bug',
        description: 'It breaks on empty passwords',
        status: 'in_progress',
      },
    });
    mockMessages = [
      {
        id: 'msg-card-1',
        roomId: 'room1',
        from: 'me',
        content: { type: 'markdown', body: '# Fix the login bug' },
        timestamp: new Date().toISOString(),
        metadata: { opcTask: { kind: 'reference', taskId: 'task-9' } },
      },
    ];
    const renderer = await renderScreen();

    // testID 落在 TaskCard 复合组件、TouchableOpacity 及其宿主节点上，取可点击的一个
    const cards = renderer.root
      .findAllByProps({ testID: 'msg-task-card-msg-card-1' })
      .filter((node) => typeof node.props.onPress === 'function');
    expect(cards.length).toBeGreaterThan(0);
    // Live title / status come from the tasks API.
    await act(async () => {
      await Promise.resolve();
    });
    expect(findByTestId(renderer.root, 'task-card-title-task-9').props.children).toBe(
      'Fix the login bug',
    );
    expect(findByTestId(renderer.root, 'task-card-status-task-9').props.children).toBe(
      'in progress',
    );

    await act(async () => {
      cards[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('TaskDetail', { taskId: 'task-9' });
  });

  it('renders regular messages without opcTask metadata as plain bubbles', async () => {
    mockMessages = [
      {
        id: 'msg-plain-1',
        roomId: 'room1',
        from: 'me',
        content: { type: 'text', body: 'hello' },
        timestamp: new Date().toISOString(),
      },
    ];
    const renderer = await renderScreen();

    expect(findByTestId(renderer.root, 'msg-bubble-me-msg-plain-1')).toBeDefined();
    expect(renderer.root.findAllByProps({ testID: 'msg-task-card-msg-plain-1' })).toHaveLength(0);
  });
});
