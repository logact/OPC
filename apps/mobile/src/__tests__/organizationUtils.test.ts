import type { DepartmentNode, StaffProfile } from '@logact-pub/opc-protocol';
import {
  departmentIsWithin,
  flattenDepartments,
  staffInDepartment,
} from '../utils/organization';

const timestamp = '2026-08-02T00:00:00.000Z';
const node = (
  id: string,
  parentId: string | null,
  children: DepartmentNode[] = [],
): DepartmentNode => ({
  id,
  organizationId: 'default',
  name: id,
  parentId,
  positions: [],
  leaders: [],
  children,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const tree = [
  node('l1', null, [node('l2', 'l1', [node('l3', 'l2', [node('l4', 'l3')])])]),
];

describe('organization tree helpers', () => {
  it('flattens and resolves arbitrary depth', () => {
    const flat = flattenDepartments(tree);
    expect(flat.map(item => item.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(departmentIsWithin(flat, 'l1', 'l4')).toBe(true);
    expect(departmentIsWithin(flat, 'l3', 'l2')).toBe(false);
  });

  it('composes direct and descendant staff scopes', () => {
    const profile: StaffProfile = {
      participantId: 'alice',
      organizationId: 'default',
      isOwner: false,
      assignments: [
        {
          id: 'a1',
          staffParticipantId: 'alice',
          positionId: 'p1',
          departmentId: 'l4',
          active: true,
          isDepartmentLeader: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      effectiveResponsibilities: [],
      effectiveSkillTags: [],
      effectiveCapabilityGrants: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const flat = flattenDepartments(tree);
    expect(staffInDepartment([profile], 'l1', true, flat)).toEqual([profile]);
    expect(staffInDepartment([profile], 'l1', false, flat)).toEqual([]);
  });
});
