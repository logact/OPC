import type { Task } from '@logact-pub/opc-protocol';
import { filterTasksForScope } from '../utils/taskScopes';

const timestamp = '2026-08-02T00:00:00.000Z';
function task(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  const { id, ...rest } = overrides;
  return {
    id,
    title: id,
    description: '',
    creatorId: 'creator',
    status: 'assigned',
    assigneeId: 'assignee',
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
  task({ id: 'other', creatorId: 'other', assigneeId: 'other' }),
];

describe('filterTasksForScope', () => {
  it.each([
    ['created', 'creator'],
    ['assigned', 'assignee'],
  ] as const)('filters the %s scope by participant role', (scope, actor) => {
    expect(filterTasksForScope(tasks, scope, actor)).toEqual([tasks[0]]);
  });

  it('does not expose scoped tasks before identity is available', () => {
    expect(filterTasksForScope(tasks, 'created', null)).toEqual([]);
    expect(filterTasksForScope(tasks, 'assigned', null)).toEqual([]);
  });
});
