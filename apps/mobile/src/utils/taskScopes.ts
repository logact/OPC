import type { Task } from '@logact-pub/opc-protocol';

export type TaskScope = 'created' | 'assigned';

export function filterTasksForScope(
  tasks: Task[],
  scope: TaskScope,
  participantId: string | null,
): Task[] {
  if (!participantId) return [];
  return tasks.filter(task =>
    scope === 'created'
      ? task.creatorId === participantId
      : task.assigneeId === participantId,
  );
}
