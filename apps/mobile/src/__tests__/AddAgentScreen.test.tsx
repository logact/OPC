import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AddAgentScreen } from '../screens/AddAgentScreen';

// Rendered components schedule React state updates; opt into act() semantics.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = jest.fn();
const mockLoadRooms = jest.fn();
const mockList = jest.fn();
const mockRegister = jest.fn();
const mockCreateDirect = jest.fn();

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
    register: (...args: unknown[]) => mockRegister(...args),
  },
  roomsApi: {
    createDirect: (...args: unknown[]) => mockCreateDirect(...args),
  },
  setAuthToken: jest.fn(),
}));

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ participantId: 'me', token: 'my-token' }),
}));

jest.mock('../hooks/useRoom', () => ({
  useRoom: () => ({ loadRooms: () => mockLoadRooms() }),
}));

const GATEWAY = { id: 'gw-1', name: 'Edge Gateway', kind: 'gateway' as const };

function findByTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<AddAgentScreen />);
  });
  return renderer;
}

function unmountScreen(renderer: TestRenderer.ReactTestRenderer) {
  act(() => {
    renderer.unmount();
  });
}

async function changeText(root: TestRenderer.ReactTestInstance, testID: string, text: string) {
  await act(async () => {
    findByTestId(root, testID).props.onChangeText(text);
  });
}

async function press(root: TestRenderer.ReactTestInstance, testID: string) {
  await act(async () => {
    await findByTestId(root, testID).props.onPress();
  });
}

describe('AddAgentScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue({ participants: [GATEWAY] });
    mockRegister.mockResolvedValue({ participantId: 'agent-1', token: 'agent-token' });
    mockCreateDirect.mockResolvedValue({ roomId: 'room-1' });
    mockLoadRooms.mockResolvedValue(undefined);
  });

  it('lists gateways on focus and preselects a single gateway', async () => {
    const renderer = await renderScreen();
    const root = renderer.root;

    expect(mockList).toHaveBeenCalledWith({ kind: 'gateway' });
    expect(findByTestId(root, 'addagent-gateway-item-gw-1')).toBeDefined();

    unmountScreen(renderer);
  });

  it('shows the empty state when no gateway is registered', async () => {
    mockList.mockResolvedValue({ participants: [] });
    const renderer = await renderScreen();

    expect(findByTestId(renderer.root, 'addagent-gateways-empty')).toBeDefined();

    unmountScreen(renderer);
  });

  it('registers the agent via the selected gateway and opens the DM', async () => {
    const renderer = await renderScreen();
    const root = renderer.root;

    await changeText(root, 'addagent-name-input', 'Code Reviewer');
    await press(root, 'addagent-provider-openai');
    await changeText(root, 'addagent-model-input', 'gpt-5');
    await changeText(root, 'addagent-apikey-input', 'sk-test');
    await press(root, 'addagent-submit');

    expect(mockRegister).toHaveBeenCalledTimes(1);
    const [agentId, payload] = mockRegister.mock.calls[0] as [string, Record<string, unknown>];
    expect(agentId).toMatch(/^code-reviewer-[a-z0-9]{4}$/);
    expect(payload).toEqual({
      name: 'Code Reviewer',
      kind: 'agent',
      gatewayId: 'gw-1',
      model: { provider: 'openai', modelId: 'gpt-5', apiKey: 'sk-test' },
    });
    expect(mockCreateDirect).toHaveBeenCalledWith(['me', agentId]);
    expect(mockLoadRooms).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Room', {
      roomId: 'room-1',
      roomName: 'Code Reviewer',
    });

    unmountScreen(renderer);
  });

  it('omits the api key from the model config when left empty', async () => {
    const renderer = await renderScreen();
    const root = renderer.root;

    await changeText(root, 'addagent-name-input', 'Code Reviewer');
    await changeText(root, 'addagent-model-input', 'claude-sonnet-4-5');
    await press(root, 'addagent-submit');

    const [, payload] = mockRegister.mock.calls[0] as [
      string,
      { model: Record<string, unknown> },
    ];
    // Default provider, no apiKey key at all.
    expect(payload.model).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-5' });

    unmountScreen(renderer);
  });

  it('requires a gateway selection when none is preselected', async () => {
    mockList.mockResolvedValue({
      participants: [GATEWAY, { id: 'gw-2', name: 'Second Gateway', kind: 'gateway' }],
    });
    const renderer = await renderScreen();
    const root = renderer.root;

    await changeText(root, 'addagent-name-input', 'Code Reviewer');
    await changeText(root, 'addagent-model-input', 'claude-sonnet-4-5');
    await press(root, 'addagent-submit');

    expect(mockRegister).not.toHaveBeenCalled();
    expect(findByTestId(root, 'toast')).toBeDefined();

    unmountScreen(renderer);
  });

  it('validates required fields before submitting', async () => {
    const renderer = await renderScreen();
    const root = renderer.root;

    // Gateway is preselected (single gateway), but name/model are empty.
    await press(root, 'addagent-submit');

    expect(mockRegister).not.toHaveBeenCalled();
    expect(findByTestId(root, 'toast')).toBeDefined();

    unmountScreen(renderer);
  });
});
