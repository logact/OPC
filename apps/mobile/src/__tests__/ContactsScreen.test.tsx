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
