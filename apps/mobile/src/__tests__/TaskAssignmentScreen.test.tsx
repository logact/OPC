import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const timestamp = '2026-08-02T00:00:00.000Z';
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockMutate = jest.fn();
const mockDepartments = [
  {
    id: 'platform',
    organizationId: 'default',
    name: 'Platform',
    parentId: null,
    positions: [],
    leaders: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    children: [
      {
        id: 'runtime',
        organizationId: 'default',
        name: 'Runtime',
        parentId: 'platform',
        positions: [],
        leaders: [],
        children: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'quality',
        organizationId: 'default',
        name: 'Quality',
        parentId: 'platform',
        positions: [],
        leaders: [],
        children: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  },
];
const mockTask = {
  id: 'task-1',
  title: 'Task',
  description: '',
  departmentId: 'platform',
  creatorId: 'me',
  target: null,
  requiredSkillTags: ['typescript'],
  status: 'draft',
  assigneeId: null,
  collaboratorIds: [],
  reviewerId: null,
  roomId: null,
  latestResultId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  assignedAt: null,
  startedAt: null,
  completedAt: null,
};
const mockParticipants = [
  { id: 'alice', name: 'Alice', kind: 'human' },
  { id: 'agent', name: 'Task Runner', kind: 'agent' },
  { id: 'ben', name: 'Ben', kind: 'human' },
];
const assignment = (participantId: string, departmentId: string) => ({
  id: `a-${participantId}`,
  staffParticipantId: participantId,
  positionId: `p-${participantId}`,
  departmentId,
  active: true,
  isDepartmentLeader: false,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const mockStaff = mockParticipants.map(participant => ({
  participantId: participant.id,
  organizationId: 'default',
  isOwner: false,
  assignments: [
    assignment(
      participant.id,
      participant.id === 'alice'
        ? 'platform'
        : participant.id === 'agent'
        ? 'runtime'
        : 'quality',
    ),
  ],
  effectiveResponsibilities: [],
  effectiveSkillTags: [],
  effectiveCapabilityGrants: [],
  createdAt: timestamp,
  updatedAt: timestamp,
}));

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
    if (queryKey[0] === 'task' && queryKey[2] === 'recommendations')
      return {
        data: {
          recommendations: [
            {
              participantId: 'alice',
              participantKind: 'human',
              name: 'Alice',
              targetMatch: 'position',
              matchedSkillTags: ['typescript'],
              availability: 'idle',
              activeTaskCount: 0,
              score: 250,
              reasons: [
                { code: 'target.position', detail: 'matched position target' },
              ],
            },
          ],
        },
        isLoading: false,
        error: null,
        refetch: jest.fn(),
      };
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
      };
    if (queryKey[0] === 'participants')
      return {
        data: { participants: mockParticipants },
        isLoading: false,
        error: null,
      };
    if (queryKey[1] === 'staff')
      return { data: { staff: mockStaff }, isLoading: false, error: null };
    return {
      data: { departments: mockDepartments },
      isLoading: false,
      error: null,
    };
  },
}));
jest.mock('../api/http', () => ({
  tasksApi: { get: jest.fn(), recommend: jest.fn(), assign: jest.fn() },
  participantsApi: { list: jest.fn() },
  organizationApi: { listStaff: jest.fn(), tree: jest.fn() },
}));
jest.mock('../hooks/useParticipantPresence', () => ({
  useParticipantPresence: () => ({}),
}));
jest.mock('../stores/capabilityStore', () => ({
  useCapabilityStore: (selector: (state: unknown) => unknown) =>
    selector({ can: () => true }),
}));

import { TaskAssignmentScreen } from '../screens/TaskAssignmentScreen';

function byTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

describe('TaskAssignmentScreen', () => {
  it('requires a separate role review before explicit confirmation', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TaskAssignmentScreen />);
    });
    await act(async () => {
      byTestId(renderer.root, 'candidate-select-alice').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'assignment-collaborators').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'participant-option-agent').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'assignment-reviewer').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'participant-option-ben').props.onPress();
    });
    await act(async () => {
      byTestId(renderer.root, 'assignment-review').props.onPress();
    });
    expect(byTestId(renderer.root, 'assignment-confirmation')).toBeTruthy();
    expect(
      byTestId(renderer.root, 'assignment-confirm-assignee-alice'),
    ).toBeTruthy();
    expect(
      byTestId(renderer.root, 'assignment-confirm-collaborator-agent'),
    ).toBeTruthy();
    expect(
      byTestId(renderer.root, 'assignment-confirm-reviewer-ben'),
    ).toBeTruthy();
  });
});
