import type { Task } from '@logact-pub/opc-protocol';
import { availableTaskActions } from '../utils/taskActions';

const timestamp = '2026-08-02T00:00:00.000Z';
function task(status: Task['status']): Task {
  return {
    id: 'task-1',
    title: 'Task',
    description: '',
    departmentId: 'department-1',
    creatorId: 'creator',
    target: null,
    requiredSkillTags: [],
    status,
    assigneeId: 'assignee',
    collaboratorIds: ['collaborator'],
    reviewerId: 'reviewer',
    roomId: 'room-1',
    latestResultId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    assignedAt: timestamp,
    startedAt: status === 'draft' || status === 'assigned' ? null : timestamp,
    completedAt: ['completed', 'failed', 'cancelled'].includes(status)
      ? timestamp
      : null,
  };
}
const denied = () => false;

describe('availableTaskActions', () => {
  it('exposes assignee lifecycle actions by status', () => {
    expect(
      availableTaskActions({
        task: task('assigned'),
        participantId: 'assignee',
        can: denied,
      }),
    ).toContain('start');
    expect(
      availableTaskActions({
        task: task('in_progress'),
        participantId: 'assignee',
        can: denied,
      }),
    ).toEqual(expect.arrayContaining(['block', 'submit']));
    expect(
      availableTaskActions({
        task: task('blocked'),
        participantId: 'assignee',
        can: denied,
      }),
    ).toContain('resume');
  });

  it('keeps approve/reject exclusive to the explicit reviewer', () => {
    expect(
      availableTaskActions({
        task: task('review'),
        participantId: 'reviewer',
        can: denied,
      }),
    ).toEqual(expect.arrayContaining(['approve', 'reject']));
    expect(
      availableTaskActions({
        task: task('review'),
        participantId: 'creator',
        can: denied,
      }),
    ).not.toEqual(expect.arrayContaining(['approve']));
  });

  it('gates assignment by task.assign and preserves creator edit/cancel', () => {
    const draft = task('draft');
    expect(
      availableTaskActions({
        task: draft,
        participantId: 'creator',
        can: denied,
      }),
    ).toEqual(expect.arrayContaining(['edit', 'cancel']));
    expect(
      availableTaskActions({
        task: draft,
        participantId: 'creator',
        can: denied,
      }),
    ).not.toContain('assign');
    expect(
      availableTaskActions({
        task: draft,
        participantId: 'manager',
        can: capability => capability === 'task.assign',
      }),
    ).toContain('assign');
  });
});
