import type { CapabilityName, Task } from '@logact-pub/opc-protocol';

export type TaskAction =
  | 'edit'
  | 'assign'
  | 'start'
  | 'block'
  | 'resume'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'cancel';

export function availableTaskActions({
  task,
  participantId,
  can,
}: {
  task: Task;
  participantId: string;
  can: (capability: CapabilityName, departmentId: string) => boolean;
}): TaskAction[] {
  const actions: TaskAction[] = [];
  const creator = task.creatorId === participantId;
  const assignee = task.assigneeId === participantId;
  const reviewer = task.reviewerId === participantId;
  if (task.status === 'draft' && creator) actions.push('edit');
  if (
    ['draft', 'assigned', 'in_progress', 'blocked'].includes(task.status) &&
    can('task.assign', task.departmentId)
  )
    actions.push('assign');
  if (task.status === 'assigned' && assignee) actions.push('start');
  if (task.status === 'in_progress' && assignee)
    actions.push('block', 'submit');
  if (task.status === 'blocked' && assignee) actions.push('resume');
  if (task.status === 'review' && reviewer) actions.push('reject', 'approve');
  if (
    !['completed', 'failed', 'cancelled'].includes(task.status) &&
    (creator || can('task.manage', task.departmentId))
  )
    actions.push('cancel');
  return actions;
}
