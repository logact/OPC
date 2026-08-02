import type { Task } from '@logact-pub/opc-protocol';
import { filterTasksForScope } from '../utils/taskScopes';

const timestamp = '2026-08-02T00:00:00.000Z';
function task(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  const { id, ...rest } = overrides;
  return {
    id,
    title: id,
    description: '',
    departmentId: 'department-1',
    creatorId: 'creator',
    target: null,
    requiredSkillTags: [],
    status: 'assigned',
    assigneeId: 'assignee',
    collaboratorIds: ['collaborator'],
    reviewerId: 'reviewer',
    roomId: null,
    latestResultId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    assignedAt: timestamp,
    startedAt: null,
    completedAt: null,
    ...rest,
  };
}

const tasks = [
  task({ id: 'mine' }),
  task({
    id: 'other',
    departmentId: 'department-2',
    creatorId: 'other',
    assigneeId: 'other',
    collaboratorIds: [],
    reviewerId: 'other',
  }),
];

describe('filterTasksForScope', () => {
  it.each([
    ['created', 'creator'],
    ['assigned', 'assignee'],
    ['collaborating', 'collaborator'],
    ['review', 'reviewer'],
  ] as const)('filters the %s scope by participant role', (scope, actor) => {
    expect(filterTasksForScope(tasks, scope, actor, () => false)).toEqual([
      tasks[0],
    ]);
  });

  it('filters managed tasks by department capability', () => {
    expect(
      filterTasksForScope(
        tasks,
        'managed',
        'manager',
        (_capability, departmentId) => departmentId === 'department-2',
      ),
    ).toEqual([tasks[1]]);
  });

  it('does not expose role-scoped tasks before identity is available', () => {
    expect(filterTasksForScope(tasks, 'created', null, () => true)).toEqual([]);
  });
});
