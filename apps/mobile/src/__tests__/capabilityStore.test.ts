jest.mock('../api/http', () => ({ organizationApi: {} }));

import type {
  Department,
  Position,
  StaffProfile,
} from '@logact-pub/opc-protocol';
import { resolveCapability } from '../stores/capabilityStore';

const timestamp = '2026-08-02T00:00:00.000Z';
const departments: Department[] = [
  {
    id: 'root',
    organizationId: 'default',
    name: 'Root',
    parentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'child',
    organizationId: 'default',
    name: 'Child',
    parentId: 'root',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'leaf',
    organizationId: 'default',
    name: 'Leaf',
    parentId: 'child',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'other',
    organizationId: 'default',
    name: 'Other',
    parentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

function profile(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    participantId: 'me',
    organizationId: 'default',
    isOwner: false,
    assignments: [
      {
        id: 'a1',
        staffParticipantId: 'me',
        positionId: 'p1',
        departmentId: 'root',
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
    ...overrides,
  };
}

function position(
  scope: 'self' | 'department' | 'department_subtree' | 'organization',
): Position {
  return {
    id: 'p1',
    departmentId: 'root',
    name: 'Role',
    responsibilities: [],
    skillTags: [],
    capabilityGrants: [{ capability: 'room.read', scope: { type: scope } }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('resolveCapability', () => {
  it('resolves organization and department-subtree scopes against the tree', () => {
    expect(
      resolveCapability(
        'me',
        profile(),
        [position('organization')],
        departments,
        'room.read',
        { departmentId: 'other' },
      ),
    ).toBe(true);
    expect(
      resolveCapability(
        'me',
        profile(),
        [position('department_subtree')],
        departments,
        'room.read',
        { departmentId: 'leaf' },
      ),
    ).toBe(true);
    expect(
      resolveCapability(
        'me',
        profile(),
        [position('department_subtree')],
        departments,
        'room.read',
        { departmentId: 'other' },
      ),
    ).toBe(false);
    expect(
      resolveCapability(
        'me',
        profile(),
        [position('self')],
        departments,
        'room.read',
        { self: true, departmentId: 'other' },
      ),
    ).toBe(true);
  });

  it('matches self scope only for the current participant', () => {
    expect(
      resolveCapability(
        'me',
        profile(),
        [position('self')],
        departments,
        'room.read',
        { participantId: 'me' },
      ),
    ).toBe(true);
    expect(
      resolveCapability(
        'me',
        profile(),
        [position('self')],
        departments,
        'room.read',
        { participantId: 'alice' },
      ),
    ).toBe(false);
  });

  it('mirrors leader-implied management over the department subtree', () => {
    const leader = profile({
      assignments: [{ ...profile().assignments[0], isDepartmentLeader: true }],
    });
    expect(
      resolveCapability('me', leader, [], departments, 'department.manage', {
        departmentId: 'leaf',
      }),
    ).toBe(true);
    expect(
      resolveCapability('me', leader, [], departments, 'department.manage', {
        departmentId: 'other',
      }),
    ).toBe(false);
    expect(
      resolveCapability('me', leader, [], departments, 'room.read', {
        departmentId: 'leaf',
      }),
    ).toBe(false);
  });

  it('allows owners and ignores inactive assignments', () => {
    expect(
      resolveCapability(
        'me',
        profile({ isOwner: true }),
        [],
        departments,
        'organization.manage',
      ),
    ).toBe(true);
    const inactive = profile({
      assignments: [{ ...profile().assignments[0], active: false }],
    });
    expect(
      resolveCapability(
        'me',
        inactive,
        [position('organization')],
        departments,
        'room.read',
      ),
    ).toBe(false);
  });
});
