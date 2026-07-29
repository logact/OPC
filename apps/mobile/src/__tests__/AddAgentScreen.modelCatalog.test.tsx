import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AddAgentScreen } from '../screens/AddAgentScreen';

/**
 * AddAgentScreen：gateway 模型目录（modelCatalog）驱动的 provider/model 选择。
 *
 * 目标行为（spec #70，实现落地前预期 red）：
 * - 选中的 gateway 带有 metadata.modelCatalog 时，PROVIDER chips 来自 catalog，
 *   硬编码 PROVIDERS 列表中不在 catalog 里的 provider（如 deepseek）不渲染；
 * - 选择 catalog provider 后，该 provider 的模型以可点选列表渲染
 *   （约定 testID：`addagent-model-item-${modelId}`），不再要求手输 modelId；
 * - 提交时 participantsApi.register 的 model 为 catalog 中的
 *   { provider, modelId }；
 * - gateway 无 catalog 时保持现状：5 个硬编码 provider chips +
 *   `addagent-model-input` 自由文本输入。
 *
 * testID 约定（与实现对齐的契约）：provider chips 沿用
 * `addagent-provider-${provider}`；catalog 模型选项使用
 * `addagent-model-item-${modelId}`。
 */

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

const CATALOG = {
  providers: [
    {
      provider: 'moonshotai',
      models: [
        { id: 'kimi-k2-0905-preview', name: 'Kimi K2 0905 Preview' },
        { id: 'kimi-coding', name: 'Kimi for Coding' },
      ],
    },
    {
      provider: 'anthropic',
      models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
    },
  ],
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const GATEWAY_WITH_CATALOG = {
  id: 'gw-1',
  name: 'Edge Gateway',
  kind: 'gateway' as const,
  metadata: { modelCatalog: CATALOG },
};

const GATEWAY_NO_CATALOG = { id: 'gw-1', name: 'Edge Gateway', kind: 'gateway' as const };

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

describe('AddAgentScreen model catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegister.mockResolvedValue({ participantId: 'agent-1', token: 'agent-token' });
    mockCreateDirect.mockResolvedValue({ roomId: 'room-1' });
    mockLoadRooms.mockResolvedValue(undefined);
  });

  describe('gateway with a model catalog', () => {
    beforeEach(() => {
      mockList.mockResolvedValue({ participants: [GATEWAY_WITH_CATALOG] });
    });

    it('renders provider options from the catalog, not the hardcoded list', async () => {
      const renderer = await renderScreen();
      const root = renderer.root;

      // Catalog providers are rendered…
      expect(findByTestId(root, 'addagent-provider-moonshotai')).toBeDefined();
      expect(findByTestId(root, 'addagent-provider-anthropic')).toBeDefined();
      // …hardcoded-only providers absent from the catalog are not.
      expect(findByTestId(root, 'addagent-provider-deepseek')).toBeUndefined();
      expect(findByTestId(root, 'addagent-provider-openrouter')).toBeUndefined();

      unmountScreen(renderer);
    });

    it('lists the provider models on selection and submits provider+modelId from the catalog', async () => {
      const renderer = await renderScreen();
      const root = renderer.root;

      await press(root, 'addagent-provider-moonshotai');

      // Selecting a catalog provider shows its models as selectable options.
      expect(findByTestId(root, 'addagent-model-item-kimi-k2-0905-preview')).toBeDefined();
      expect(findByTestId(root, 'addagent-model-item-kimi-coding')).toBeDefined();

      await changeText(root, 'addagent-name-input', 'Kimi Reviewer');
      await press(root, 'addagent-model-item-kimi-coding');
      await press(root, 'addagent-submit');

      expect(mockRegister).toHaveBeenCalledTimes(1);
      const [, payload] = mockRegister.mock.calls[0] as [
        string,
        { model: Record<string, unknown> },
      ];
      expect(payload.model).toEqual({ provider: 'moonshotai', modelId: 'kimi-coding' });

      unmountScreen(renderer);
    });
  });

  describe('gateway without a model catalog', () => {
    beforeEach(() => {
      mockList.mockResolvedValue({ participants: [GATEWAY_NO_CATALOG] });
    });

    it('keeps the hardcoded providers and the free-text model input', async () => {
      const renderer = await renderScreen();
      const root = renderer.root;

      for (const p of ['anthropic', 'openai', 'google', 'deepseek', 'openrouter']) {
        expect(findByTestId(root, `addagent-provider-${p}`)).toBeDefined();
      }
      expect(findByTestId(root, 'addagent-model-input')).toBeDefined();

      await changeText(root, 'addagent-name-input', 'Deepseek Helper');
      await press(root, 'addagent-provider-deepseek');
      await changeText(root, 'addagent-model-input', 'deepseek-chat');
      await press(root, 'addagent-submit');

      expect(mockRegister).toHaveBeenCalledTimes(1);
      const [, payload] = mockRegister.mock.calls[0] as [
        string,
        { model: Record<string, unknown> },
      ];
      expect(payload.model).toEqual({ provider: 'deepseek', modelId: 'deepseek-chat' });

      unmountScreen(renderer);
    });
  });
});
