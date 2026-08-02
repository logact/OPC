import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockNavigate = jest.fn();
const mockRefetch = jest.fn();
const mockHydrate = jest.fn();
const mockTimestamp = '2026-08-02T00:00:00.000Z';

const mockLeaf = {
  id: 'l4',
  organizationId: 'default',
  name: 'Level 4',
  parentId: 'l3',
  positions: [],
  leaders: [],
  children: [],
  createdAt: mockTimestamp,
  updatedAt: mockTimestamp,
};
const mockTree = [
  {
    id: 'l1',
    organizationId: 'default',
    name: 'Level 1',
    parentId: null,
    positions: [],
    leaders: [],
    children: [
      {
        id: 'l2',
        organizationId: 'default',
        name: 'Level 2',
        parentId: 'l1',
        positions: [],
        leaders: [],
        children: [
          {
            id: 'l3',
            organizationId: 'default',
            name: 'Level 3',
            parentId: 'l2',
            positions: [],
            leaders: [],
            children: [mockLeaf],
            createdAt: mockTimestamp,
            updatedAt: mockTimestamp,
          },
        ],
        createdAt: mockTimestamp,
        updatedAt: mockTimestamp,
      },
    ],
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
  },
];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (...args: unknown[]) => mockNavigate(...args),
  }),
  useFocusEffect: (callback: () => void) => callback(),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[1] === 'tree'
      ? {
          data: {
            organization: {
              id: 'default',
              name: 'OPC',
              createdAt: mockTimestamp,
              updatedAt: mockTimestamp,
            },
            departments: mockTree,
          },
          isLoading: false,
          error: null,
          refetch: mockRefetch,
        }
      : {
          data: { staff: [] },
          isLoading: false,
          error: null,
          refetch: mockRefetch,
        },
}));
jest.mock('../api/http', () => ({
  organizationApi: { tree: jest.fn(), listStaff: jest.fn() },
}));
jest.mock('../hooks/useRecoverableApiError', () => ({
  useRecoverableApiError: () => null,
}));
jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ participantId: 'me' }),
}));
jest.mock('../stores/capabilityStore', () => ({
  useCapabilityStore: (selector: (state: unknown) => unknown) =>
    selector({ can: () => false, hydrate: mockHydrate }),
}));

import { OrgTreeScreen } from '../screens/OrgTreeScreen';

function byTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

describe('OrgTreeScreen', () => {
  it('renders and expands a four-level organization tree', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<OrgTreeScreen />);
    });
    expect(byTestId(renderer.root, 'org-node-l1')).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: 'org-node-l4' }),
    ).toHaveLength(0);
    await act(async () => {
      byTestId(renderer.root, 'org-node-toggle-l1').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'org-node-toggle-l2').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'org-node-toggle-l3').props.onPress();
    });
    expect(byTestId(renderer.root, 'org-node-l4')).toBeTruthy();
  });
});
