import type { Task } from '@logact-pub/opc-protocol';

export type TaskAction =
  | 'edit'
  | 'assign'
  | 'start'
  | 'block'
  | 'resume'
  | 'submit'
  | 'fail'
  | 'cancel';

/**
 * Client-side mirror of the server-side role-based task lifecycle
 * (issue #130): only the creator can edit a draft, assign/reassign, or cancel;
 * only the current assignee can start/block/resume/submit/fail. Statuses that
 * each command accepts mirror `transitionRules` in the task repository.
 */
export function availableTaskActions({
  task,
  participantId,
}: {
  task: Task;
  participantId: string;
}): TaskAction[] {
  const actions: TaskAction[] = [];
  const creator = task.creatorId === participantId;
  const assignee = task.assigneeId === participantId;
  const assignable = ['draft', 'assigned', 'in_progress', 'blocked'].includes(
    task.status,
  );
  if (task.status === 'draft' && creator) actions.push('edit');
  if (assignable && creator) actions.push('assign');
  if (task.status === 'assigned' && assignee) actions.push('start');
  if (task.status === 'in_progress' && assignee)
    actions.push('block', 'submit');
  if (task.status === 'blocked' && assignee) actions.push('resume');
  if (['assigned', 'in_progress', 'blocked'].includes(task.status) && assignee)
    actions.push('fail');
  if (assignable && creator) actions.push('cancel');
  return actions;
}
