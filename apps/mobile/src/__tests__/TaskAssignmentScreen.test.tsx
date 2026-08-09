import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const timestamp = '2026-08-02T00:00:00.000Z';
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockMutate = jest.fn();
const mockTask = {
  id: 'task-1',
  title: 'Task',
  description: '',
  creatorId: 'me',
  parentTaskId: null,
  status: 'draft',
  assigneeId: null,
  roomId: null,
  latestResultId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  assignedAt: null,
  startedAt: null,
  completedAt: null,
  progress: { total: 0, completed: 0 },
};
const mockParticipants = [
  { id: 'alice', name: 'Alice', kind: 'human' },
  { id: 'agent', name: 'Task Runner', kind: 'agent' },
  { id: 'gateway', name: 'Gateway', kind: 'gateway' },
];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: jest.fn(),
  }),
  useRoute: () => ({ params: { taskId: 'task-1' } }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: () => ({ mutate: mockMutate, isPending: false, error: null }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'task')
      return {
        data: {
          task: mockTask,
          assignments: [],
          results: [],
          transitions: [],
          events: [],
        },
        isLoading: false,
        error: null,
        refetch: jest.fn(),
      };
    return {
      data: { participants: mockParticipants },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
  },
}));
jest.mock('../api/http', () => ({
  tasksApi: { get: jest.fn(), assign: jest.fn() },
  participantsApi: { list: jest.fn() },
}));
jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ participantId: 'me' }),
}));

import { TaskAssignmentScreen } from '../screens/TaskAssignmentScreen';

function byTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

describe('TaskAssignmentScreen', () => {
  it('offers every human and agent participant and confirms in one step', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TaskAssignmentScreen />);
    });
    expect(byTestId(renderer.root, 'assignee-option-alice')).toBeTruthy();
    expect(byTestId(renderer.root, 'assignee-option-agent')).toBeTruthy();
    // Gateways are not assignable.
    expect(byTestId(renderer.root, 'assignee-option-gateway')).toBeUndefined();

    await act(async () => {
      byTestId(renderer.root, 'assignee-option-alice').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'assignment-confirm-submit').props.onPress();
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
