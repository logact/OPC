import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { ContactsScreen } from '../screens/ContactsScreen';

// Rendered components schedule React state updates; opt into act() semantics.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = jest.fn();
const mockLoadRooms = jest.fn();
const mockList = jest.fn();
const mockSubscribePresence = jest.fn();

jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  return {
    useNavigation: () => ({ navigate: (...args: unknown[]) => mockNavigate(...args) }),
    // Fire the focus callback once on mount (the screen is "focused" in tests).
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
  };
});

jest.mock('../api/http', () => ({
  participantsApi: {
    list: (...args: unknown[]) => mockList(...args),
  },
  roomsApi: {
    createDirect: jest.fn(),
  },
  setAuthToken: jest.fn(),
}));

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ participantId: 'me', token: 'my-token' }),
}));

jest.mock('../hooks/useRoom', () => ({
  useRoom: () => ({ loadRooms: () => mockLoadRooms() }),
}));

jest.mock('../contexts/MqttContext', () => ({
  useMqtt: () => ({
    client: { subscribePresence: (...args: unknown[]) => mockSubscribePresence(...args) },
    state: 'connected',
  }),
}));

const ONLINE = '#22c55e'; // theme.colors.accent2
const OFFLINE = '#8a94a8'; // theme.colors.muted

const ONLINE_CONTACT = {
  id: 'bob',
  name: 'Bob',
  kind: 'human' as const,
  presence: { online: true, lastSeen: new Date(Date.now() - 60_000).toISOString() },
};
const OFFLINE_CONTACT = {
  id: 'carol',
  name: 'Carol',
  kind: 'human' as const,
  presence: { online: false, lastSeen: new Date(Date.now() - 3 * 60_000).toISOString() },
};
// Never came online: no presence field at all.
const NEVER_ONLINE_CONTACT = { id: 'dave', name: 'Dave', kind: 'human' as const };

const IDLE = '#4f7cff'; // theme.colors.accent
const WORKING = '#22c55e'; // theme.colors.accent2
const BLOCKING = '#f59e0b'; // theme.colors.warning
const ERROR = '#ef4444'; // theme.colors.danger

const AGENT_IDLE = {
  id: 'agent-idle',
  name: 'IdleBot',
  kind: 'agent' as const,
  presence: { online: true, lastSeen: new Date().toISOString(), status: 'idle' as const },
};
const AGENT_WORKING = {
  id: 'agent-working',
  name: 'WorkBot',
  kind: 'agent' as const,
  presence: { online: true, lastSeen: new Date().toISOString(), status: 'working' as const },
};
const AGENT_BLOCKING = {
  id: 'agent-blocking',
  name: 'BlockBot',
  kind: 'agent' as const,
  presence: { online: true, lastSeen: new Date().toISOString(), status: 'blocking' as const },
};
const AGENT_ERROR = {
  id: 'agent-error',
  name: 'ErrBot',
  kind: 'agent' as const,
  presence: { online: true, lastSeen: new Date().toISOString(), status: 'error' as const },
};
// Status is only meaningful while online; online:false renders as offline.
const AGENT_OFFLINE = {
  id: 'agent-offline',
  name: 'OffBot',
  kind: 'agent' as const,
  presence: { online: false, lastSeen: new Date().toISOString(), status: 'working' as const },
};
const GATEWAY_ONLINE = {
  id: 'gw-1',
  name: 'Gateway',
  kind: 'gateway' as const,
  presence: { online: true, lastSeen: new Date().toISOString() },
};

function findByTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

function presenceDotColor(root: TestRenderer.ReactTestInstance, id: string): string {
  return StyleSheet.flatten(findByTestId(root, `contact-presence-${id}`).props.style)
    .backgroundColor as string;
}

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ContactsScreen />);
  });
  return renderer;
}

function unmountScreen(renderer: TestRenderer.ReactTestRenderer) {
  act(() => {
    renderer.unmount();
  });
}

describe('ContactsScreen presence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue({
      participants: [ONLINE_CONTACT, OFFLINE_CONTACT, NEVER_ONLINE_CONTACT],
    });
    mockSubscribePresence.mockReturnValue(jest.fn());
    mockLoadRooms.mockResolvedValue(undefined);
  });

  it('renders an online dot for an online contact', async () => {
    const renderer = await renderScreen();

    expect(presenceDotColor(renderer.root, 'bob')).toBe(ONLINE);
    // Online contacts keep the plain subtitle (no last-seen suffix).
    expect(findByTestId(renderer.root, 'contact-subtitle-bob').props.children).toBe(
      'human · e2e encrypted',
    );

    unmountScreen(renderer);
  });

  it('renders an offline dot and a relative last-seen time for an offline contact', async () => {
    const renderer = await renderScreen();

    expect(presenceDotColor(renderer.root, 'carol')).toBe(OFFLINE);
    expect(findByTestId(renderer.root, 'contact-subtitle-carol').props.children).toBe(
      'human · e2e encrypted · last seen 3 min ago',
    );

    unmountScreen(renderer);
  });

  it('treats a contact without a presence field as offline', async () => {
    const renderer = await renderScreen();

    expect(presenceDotColor(renderer.root, 'dave')).toBe(OFFLINE);
    expect(findByTestId(renderer.root, 'contact-subtitle-dave').props.children).toBe(
      'human · e2e encrypted',
    );

    unmountScreen(renderer);
  });

  it('applies live presence updates from subscribePresence and unsubscribes on unmount', async () => {
    const renderer = await renderScreen();

    expect(mockSubscribePresence).toHaveBeenCalledTimes(1);
    const listener = mockSubscribePresence.mock.calls[0]?.[0] as (
      id: string,
      presence: { online: boolean },
    ) => void;

    await act(async () => {
      listener('dave', { online: true });
    });
    expect(presenceDotColor(renderer.root, 'dave')).toBe(ONLINE);

    await act(async () => {
      listener('bob', { online: false });
    });
    expect(presenceDotColor(renderer.root, 'bob')).toBe(OFFLINE);

    const unsubscribe = mockSubscribePresence.mock.results[0]?.value as jest.Mock;
    unmountScreen(renderer);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('ContactsScreen agent presence states (issue #83)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue({
      participants: [AGENT_IDLE, AGENT_WORKING, AGENT_BLOCKING, AGENT_ERROR, AGENT_OFFLINE, GATEWAY_ONLINE],
    });
    mockSubscribePresence.mockReturnValue(jest.fn());
    mockLoadRooms.mockResolvedValue(undefined);
  });

  it('renders the 5 agent presence states with their colors and labels', async () => {
    const renderer = await renderScreen();

    expect(presenceDotColor(renderer.root, 'agent-idle')).toBe(IDLE);
    expect(presenceDotColor(renderer.root, 'agent-working')).toBe(WORKING);
    expect(presenceDotColor(renderer.root, 'agent-blocking')).toBe(BLOCKING);
    expect(presenceDotColor(renderer.root, 'agent-error')).toBe(ERROR);
    // Status is ignored while offline.
    expect(presenceDotColor(renderer.root, 'agent-offline')).toBe(OFFLINE);

    expect(findByTestId(renderer.root, 'contact-subtitle-agent-idle').props.children).toBe(
      'agent · agent-idle · idle',
    );
    expect(findByTestId(renderer.root, 'contact-subtitle-agent-working').props.children).toBe(
      'agent · agent-working · working',
    );
    expect(findByTestId(renderer.root, 'contact-subtitle-agent-blocking').props.children).toBe(
      'agent · agent-blocking · blocking',
    );
    expect(findByTestId(renderer.root, 'contact-subtitle-agent-error').props.children).toBe(
      'agent · agent-error · error',
    );

    unmountScreen(renderer);
  });

  it('keeps gateways on the binary online/offline dot', async () => {
    const renderer = await renderScreen();

    expect(presenceDotColor(renderer.root, 'gw-1')).toBe(ONLINE);
    expect(findByTestId(renderer.root, 'contact-subtitle-gw-1').props.children).toBe(
      'gateway · gw-1',
    );

    unmountScreen(renderer);
  });

  it('applies live status updates from subscribePresence', async () => {
    const renderer = await renderScreen();
    const listener = mockSubscribePresence.mock.calls[0]?.[0] as (
      id: string,
      presence: { online: boolean; status?: 'idle' | 'working' | 'blocking' | 'error' },
    ) => void;

    expect(presenceDotColor(renderer.root, 'agent-idle')).toBe(IDLE);
    await act(async () => {
      listener('agent-idle', { online: true, status: 'working' });
    });
    expect(presenceDotColor(renderer.root, 'agent-idle')).toBe(WORKING);
    expect(findByTestId(renderer.root, 'contact-subtitle-agent-idle').props.children).toBe(
      'agent · agent-idle · working',
    );

    await act(async () => {
      listener('agent-idle', { online: false });
    });
    expect(presenceDotColor(renderer.root, 'agent-idle')).toBe(OFFLINE);

    // A live payload without status keeps the fetched status (humans never carry one).
    await act(async () => {
      listener('agent-working', { online: true });
    });
    expect(presenceDotColor(renderer.root, 'agent-working')).toBe(WORKING);

    unmountScreen(renderer);
  });
});
