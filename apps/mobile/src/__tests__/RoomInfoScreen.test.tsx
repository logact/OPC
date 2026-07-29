import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { RoomInfoScreen } from '../screens/RoomInfoScreen';

// Rendered components schedule React state updates; opt into act() semantics.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockGetRoom = jest.fn();
const mockGetParticipant = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: { roomId: 'room1' } }),
}));

jest.mock('../api/http', () => ({
  roomsApi: {
    get: (...args: unknown[]) => mockGetRoom(...args),
  },
  participantsApi: {
    get: (...args: unknown[]) => mockGetParticipant(...args),
  },
}));

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ participantId: 'me', token: 'my-token' }),
}));

const WORKING = '#22c55e'; // theme.colors.accent2
const OFFLINE = '#8a94a8'; // theme.colors.muted

const ROOM = { id: 'room1', participantIds: ['me', 'agent2', 'bob'] };
const ME = { id: 'me', name: 'Me', kind: 'human' as const };
const AGENT_WORKING = {
  id: 'agent2',
  name: 'WorkBot',
  kind: 'agent' as const,
  presence: { online: true, lastSeen: new Date().toISOString(), status: 'working' as const },
};
const HUMAN_ONLINE = {
  id: 'bob',
  name: 'Bob',
  kind: 'human' as const,
  presence: { online: true, lastSeen: new Date().toISOString() },
};

function findByTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

function presenceDotColor(root: TestRenderer.ReactTestInstance, id: string): string {
  return StyleSheet.flatten(findByTestId(root, `member-presence-${id}`).props.style)
    .backgroundColor as string;
}

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<RoomInfoScreen />);
  });
  return renderer;
}

describe('RoomInfoScreen member presence (issue #83)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRoom.mockResolvedValue({ room: ROOM });
    mockGetParticipant.mockImplementation(async (id: string) => ({
      participant: id === 'me' ? ME : id === 'agent2' ? AGENT_WORKING : HUMAN_ONLINE,
    }));
  });

  it('shows a presence dot for agent members only', async () => {
    const renderer = await renderScreen();

    expect(presenceDotColor(renderer.root, 'agent2')).toBe(WORKING);
    // Humans keep their previous rendering: no presence dot on member chips.
    expect(renderer.root.findAllByProps({ testID: 'member-presence-bob' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'member-presence-me' })).toHaveLength(0);
  });

  it('renders an offline agent with the muted dot', async () => {
    mockGetParticipant.mockImplementation(async (id: string) => ({
      participant:
        id === 'agent2'
          ? { ...AGENT_WORKING, presence: { online: false, lastSeen: new Date().toISOString() } }
          : id === 'me'
            ? ME
            : HUMAN_ONLINE,
    }));
    const renderer = await renderScreen();

    expect(presenceDotColor(renderer.root, 'agent2')).toBe(OFFLINE);
  });
});
