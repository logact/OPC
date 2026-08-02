import type {
  Department,
  DepartmentNode,
  StaffProfile,
} from '@logact-pub/opc-protocol';

export function flattenDepartments(nodes: DepartmentNode[]): DepartmentNode[] {
  return nodes.flatMap(node => [node, ...flattenDepartments(node.children)]);
}

export function departmentIsWithin(
  departments: Pick<Department, 'id' | 'parentId'>[],
  rootId: string,
  targetId: string,
): boolean {
  if (rootId === targetId) return true;
  const byId = new Map(departments.map(item => [item.id, item]));
  const visited = new Set<string>();
  let cursor = byId.get(targetId)?.parentId ?? null;
  while (cursor && !visited.has(cursor)) {
    if (cursor === rootId) return true;
    visited.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

export function staffInDepartment(
  staff: StaffProfile[],
  departmentId: string,
  includeDescendants: boolean,
  departments: Pick<Department, 'id' | 'parentId'>[],
): StaffProfile[] {
  return staff.filter(profile =>
    profile.assignments.some(
      assignment =>
        assignment.active &&
        (includeDescendants
          ? departmentIsWithin(
              departments,
              departmentId,
              assignment.departmentId,
            )
          : assignment.departmentId === departmentId),
    ),
  );
}
