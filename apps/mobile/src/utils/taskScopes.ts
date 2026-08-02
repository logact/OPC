import type { CapabilityName, Task } from '@logact-pub/opc-protocol';

export type TaskScope =
  | 'created'
  | 'assigned'
  | 'collaborating'
  | 'review'
  | 'managed';

export function filterTasksForScope(
  tasks: Task[],
  scope: TaskScope,
  participantId: string | null,
  can: (capability: CapabilityName, departmentId: string) => boolean,
): Task[] {
  return tasks.filter(task => {
    if (scope === 'managed') return can('task.manage', task.departmentId);
    if (!participantId) return false;
    if (scope === 'created') return task.creatorId === participantId;
    if (scope === 'assigned') return task.assigneeId === participantId;
    if (scope === 'collaborating')
      return task.collaboratorIds.includes(participantId);
    return task.reviewerId === participantId;
  });
}
