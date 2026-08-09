import type { Task } from '@logact-pub/opc-protocol';
import { availableTaskActions } from '../utils/taskActions';

const timestamp = '2026-08-02T00:00:00.000Z';
function task(status: Task['status']): Task {
  return {
    id: 'task-1',
    title: 'Task',
    description: '',
    creatorId: 'creator',
    parentTaskId: null,
    status,
    assigneeId: 'assignee',
    roomId: 'room-1',
    latestResultId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    assignedAt: status === 'draft' ? null : timestamp,
    startedAt: status === 'draft' || status === 'assigned' ? null : timestamp,
    completedAt: ['completed', 'failed', 'cancelled'].includes(status)
      ? timestamp
      : null,
    progress: { total: 0, completed: 0 },
  };
}

describe('availableTaskActions', () => {
  it('exposes assignee lifecycle actions by status', () => {
    expect(
      availableTaskActions({ task: task('assigned'), participantId: 'assignee' }),
    ).toEqual(expect.arrayContaining(['start', 'fail']));
    expect(
      availableTaskActions({
        task: task('in_progress'),
        participantId: 'assignee',
      }),
    ).toEqual(expect.arrayContaining(['block', 'submit', 'fail']));
    expect(
      availableTaskActions({ task: task('blocked'), participantId: 'assignee' }),
    ).toEqual(expect.arrayContaining(['resume', 'fail']));
  });

  it('exposes creator edit/assign/cancel without any capability grants', () => {
    const draft = task('draft');
    draft.assigneeId = null;
    expect(
      availableTaskActions({ task: draft, participantId: 'creator' }),
    ).toEqual(['edit', 'decompose', 'assign', 'cancel']);
    expect(
      availableTaskActions({ task: task('assigned'), participantId: 'creator' }),
    ).toEqual(expect.arrayContaining(['assign', 'cancel']));
    expect(
      availableTaskActions({
        task: task('in_progress'),
        participantId: 'creator',
      }),
    ).toEqual(expect.arrayContaining(['assign', 'cancel']));
    expect(
      availableTaskActions({ task: task('blocked'), participantId: 'creator' }),
    ).toEqual(expect.arrayContaining(['assign', 'cancel']));
  });

  it('denies creator actions to the assignee and vice versa', () => {
    expect(
      availableTaskActions({ task: task('draft'), participantId: 'assignee' }),
    ).toEqual([]);
    expect(
      availableTaskActions({ task: task('assigned'), participantId: 'creator' }),
    ).not.toEqual(expect.arrayContaining(['start', 'fail']));
    expect(
      availableTaskActions({
        task: task('in_progress'),
        participantId: 'assignee',
      }),
    ).not.toEqual(expect.arrayContaining(['edit', 'assign', 'cancel']));
  });

  it('offers no actions for terminal statuses or unrelated participants', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(
        availableTaskActions({ task: task(status), participantId: 'creator' }),
      ).toEqual([]);
      expect(
        availableTaskActions({ task: task(status), participantId: 'assignee' }),
      ).toEqual([]);
    }
    expect(
      availableTaskActions({ task: task('draft'), participantId: 'stranger' }),
    ).toEqual([]);
  });
});
