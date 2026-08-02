import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  CapabilityGrant,
  CreateDepartmentRequest,
  CreatePositionRequest,
  CreateStaffAssignmentRequest,
  Department,
  DepartmentNode,
  Organization,
  OrganizationErrorCode,
  ParticipantKind,
  Position,
  Responsibility,
  StaffAssignment,
  StaffProfile,
  UpdateDepartmentRequest,
  UpdatePositionRequest,
  UpdateStaffAssignmentRequest,
} from '@logact-pub/opc-protocol';
import type { DbClient } from '../client/index.js';
import {
  DEFAULT_ORGANIZATION_ID,
  departments,
  organizations,
  participants,
  positions,
  staffAssignments,
  staffProfiles,
  type DepartmentRow,
  type OrganizationRow,
  type PositionRow,
  type StaffAssignmentRow,
  type StaffProfileRow,
} from '../schema/index.js';

export class OrganizationRepositoryError extends Error {
  constructor(
    readonly code: OrganizationErrorCode,
    readonly status: 404 | 409 | 422,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OrganizationRepositoryError';
  }
}

function notFound(
  code: Extract<OrganizationErrorCode, `${string}_not_found`>,
  message: string
): OrganizationRepositoryError {
  return new OrganizationRepositoryError(code, 404, message);
}

function conflict(
  code: OrganizationErrorCode,
  message: string,
  details?: Record<string, unknown>
): OrganizationRepositoryError {
  return new OrganizationRepositoryError(code, 409, message, details);
}

function invalid(
  code: OrganizationErrorCode,
  message: string,
  details?: Record<string, unknown>
): OrganizationRepositoryError {
  return new OrganizationRepositoryError(code, 422, message, details);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPosition(row: PositionRow): Position {
  return {
    id: row.id,
    departmentId: row.departmentId,
    name: row.name,
    description: row.description ?? undefined,
    responsibilities: row.responsibilities,
    skillTags: [...new Set(row.skillTags)].sort(),
    capabilityGrants: row.capabilityGrants,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAssignment(row: StaffAssignmentRow, departmentId: string): StaffAssignment {
  return {
    id: row.id,
    staffParticipantId: row.staffParticipantId,
    positionId: row.positionId,
    departmentId,
    active: row.active,
    isDepartmentLeader: row.isDepartmentLeader,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const scopeOrder: Record<CapabilityGrant['scope']['type'], number> = {
  self: 0,
  department: 1,
  department_subtree: 2,
  organization: 3,
};

function effectiveValues(positionRows: PositionRow[]): {
  responsibilities: Responsibility[];
  skillTags: string[];
  grants: CapabilityGrant[];
} {
  const responsibilities = new Map<string, Responsibility>();
  const skillTags = new Set<string>();
  const grants = new Map<string, CapabilityGrant>();

  for (const position of positionRows) {
    for (const responsibility of position.responsibilities) {
      if (!responsibilities.has(responsibility.id)) {
        responsibilities.set(responsibility.id, responsibility);
      }
    }
    for (const tag of position.skillTags) skillTags.add(tag);
    for (const grant of position.capabilityGrants) {
      grants.set(`${grant.capability}\u0000${grant.scope.type}`, grant);
    }
  }

  return {
    responsibilities: [...responsibilities.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    skillTags: [...skillTags].sort(),
    grants: [...grants.values()].sort(
      (left, right) =>
        left.capability.localeCompare(right.capability) ||
        scopeOrder[left.scope.type] - scopeOrder[right.scope.type]
    ),
  };
}

export function createOrganizationRepository(db: DbClient) {
  async function findOrganizationRow(): Promise<OrganizationRow> {
    const row = await db.query.organizations.findFirst({
      where: eq(organizations.id, DEFAULT_ORGANIZATION_ID),
    });
    if (!row) throw notFound('organization_not_found', 'organization not found');
    return row;
  }

  async function findDepartmentRow(id: string): Promise<DepartmentRow> {
    if (!isUuid(id)) throw notFound('department_not_found', `department ${id} not found`);
    const row = await db.query.departments.findFirst({ where: eq(departments.id, id) });
    if (!row) throw notFound('department_not_found', `department ${id} not found`);
    return row;
  }

  async function findPositionRow(id: string): Promise<PositionRow> {
    if (!isUuid(id)) throw notFound('position_not_found', `position ${id} not found`);
    const row = await db.query.positions.findFirst({ where: eq(positions.id, id) });
    if (!row) throw notFound('position_not_found', `position ${id} not found`);
    return row;
  }

  async function buildStaffProfile(profile: StaffProfileRow): Promise<StaffProfile> {
    const assignmentRows = await db
      .select()
      .from(staffAssignments)
      .where(eq(staffAssignments.staffParticipantId, profile.participantId))
      .orderBy(asc(staffAssignments.createdAt), asc(staffAssignments.id));
    const positionIds = [...new Set(assignmentRows.map((assignment) => assignment.positionId))];
    const positionRows = positionIds.length
      ? await db.select().from(positions).where(inArray(positions.id, positionIds))
      : [];
    const positionById = new Map(positionRows.map((position) => [position.id, position]));
    const assignments = assignmentRows.map((assignment) => {
      const position = positionById.get(assignment.positionId);
      if (!position) throw new Error(`position ${assignment.positionId} missing for assignment`);
      return toAssignment(assignment, position.departmentId);
    });
    const activePositions = assignmentRows
      .filter((assignment) => assignment.active)
      .map((assignment) => positionById.get(assignment.positionId))
      .filter((position): position is PositionRow => position !== undefined);
    const effective = effectiveValues(activePositions);

    return {
      participantId: profile.participantId,
      organizationId: profile.organizationId,
      isOwner: profile.isOwner,
      assignments,
      effectiveResponsibilities: effective.responsibilities,
      effectiveSkillTags: effective.skillTags,
      effectiveCapabilityGrants: effective.grants,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async function getStaffProfile(participantId: string): Promise<StaffProfile> {
    const profile = await db.query.staffProfiles.findFirst({
      where: eq(staffProfiles.participantId, participantId),
    });
    if (!profile) {
      const participant = await db.query.participants.findFirst({
        where: eq(participants.id, participantId),
      });
      if (participant?.kind === 'gateway') {
        throw invalid('participant_not_staff', `participant ${participantId} is a gateway`);
      }
      throw notFound('staff_not_found', `staff ${participantId} not found`);
    }
    return buildStaffProfile(profile);
  }

  async function assertParticipantKindChange(
    participantId: string,
    nextKind: ParticipantKind
  ): Promise<void> {
    if (nextKind === 'human') return;
    const profile = await db.query.staffProfiles.findFirst({
      where: eq(staffProfiles.participantId, participantId),
    });
    if (!profile) return;
    if (profile.isOwner) {
      throw conflict('owner_immutable', 'the Owner must remain a human participant');
    }
    if (nextKind !== 'gateway') return;
    const assignment = await db.query.staffAssignments.findFirst({
      where: eq(staffAssignments.staffParticipantId, participantId),
    });
    if (assignment) {
      throw conflict(
        'staff_has_assignments',
        'staff with assignments cannot become a gateway',
        { participantId }
      );
    }
  }

  async function reconcileParticipant(
    participantId: string,
    kind: ParticipantKind,
    ownerEligible = false
  ): Promise<void> {
    if (participantId === 'system') return;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('opc-organization-owner'))`);
      await tx
        .insert(organizations)
        .values({ id: DEFAULT_ORGANIZATION_ID, name: 'OPC' })
        .onConflictDoNothing({ target: organizations.id });

      const existing = await tx.query.staffProfiles.findFirst({
        where: eq(staffProfiles.participantId, participantId),
      });
      if (existing?.isOwner && kind !== 'human') {
        throw conflict('owner_immutable', 'the Owner must remain a human participant');
      }
      if (kind === 'gateway') {
        if (!existing) return;
        if (existing.isOwner) {
          throw conflict('owner_immutable', 'the Owner must remain a human participant');
        }
        const assignment = await tx.query.staffAssignments.findFirst({
          where: eq(staffAssignments.staffParticipantId, participantId),
        });
        if (assignment) {
          throw conflict('staff_has_assignments', 'staff with assignments cannot become a gateway');
        }
        await tx.delete(staffProfiles).where(eq(staffProfiles.participantId, participantId));
        return;
      }

      let isOwner = false;
      if (kind === 'human' && ownerEligible) {
        const owner = await tx.query.staffProfiles.findFirst({
          where: eq(staffProfiles.isOwner, true),
        });
        isOwner = owner === undefined;
      }
      if (existing) {
        if (isOwner) {
          await tx
            .update(staffProfiles)
            .set({ isOwner: true, updatedAt: new Date() })
            .where(eq(staffProfiles.participantId, participantId));
        }
        return;
      }
      await tx.insert(staffProfiles).values({
        participantId,
        organizationId: DEFAULT_ORGANIZATION_ID,
        isOwner,
      });
    });
  }

  return {
    async hasOwner(): Promise<boolean> {
      const owner = await db.query.staffProfiles.findFirst({
        where: eq(staffProfiles.isOwner, true),
      });
      return owner !== undefined;
    },

    async getOrganization(): Promise<Organization> {
      return toOrganization(await findOrganizationRow());
    },

    async updateOrganization(name: string): Promise<Organization> {
      const [row] = await db
        .update(organizations)
        .set({ name, updatedAt: new Date() })
        .where(eq(organizations.id, DEFAULT_ORGANIZATION_ID))
        .returning();
      if (!row) throw notFound('organization_not_found', 'organization not found');
      return toOrganization(row);
    },

    async listDepartments(): Promise<Department[]> {
      const rows = await db
        .select()
        .from(departments)
        .where(eq(departments.organizationId, DEFAULT_ORGANIZATION_ID))
        .orderBy(asc(departments.name), asc(departments.id));
      return rows.map(toDepartment);
    },

    async getDepartment(id: string): Promise<Department> {
      return toDepartment(await findDepartmentRow(id));
    },

    async createDepartment(input: CreateDepartmentRequest): Promise<Department> {
      return db.transaction(async (tx) => {
        if (input.parentId) {
          if (!isUuid(input.parentId)) {
            throw invalid(
              'invalid_department_parent',
              `department parent ${input.parentId} not found`
            );
          }
          const parent = await tx.query.departments.findFirst({
            where: eq(departments.id, input.parentId),
          });
          if (!parent) {
            throw invalid(
              'invalid_department_parent',
              `department parent ${input.parentId} not found`
            );
          }
        }
        const [row] = await tx
          .insert(departments)
          .values({
            organizationId: DEFAULT_ORGANIZATION_ID,
            name: input.name,
            parentId: input.parentId ?? null,
          })
          .returning();
        return toDepartment(row);
      });
    },

    async updateDepartment(id: string, input: UpdateDepartmentRequest): Promise<Department> {
      if (!isUuid(id)) throw notFound('department_not_found', `department ${id} not found`);
      return db.transaction(async (tx) => {
        const current = await tx.query.departments.findFirst({ where: eq(departments.id, id) });
        if (!current) throw notFound('department_not_found', `department ${id} not found`);
        if (input.parentId !== undefined && input.parentId !== null) {
          if (!isUuid(input.parentId)) {
            throw invalid(
              'invalid_department_parent',
              `department parent ${input.parentId} not found`
            );
          }
          if (input.parentId === id) {
            throw conflict('department_cycle', 'department cannot be its own parent');
          }
          let cursor: string | null = input.parentId;
          while (cursor) {
            const parent: DepartmentRow | undefined = await tx.query.departments.findFirst({
              where: eq(departments.id, cursor),
            });
            if (!parent) {
              throw invalid('invalid_department_parent', `department parent ${cursor} not found`);
            }
            if (parent.id === id) {
              throw conflict('department_cycle', 'department move would create a cycle');
            }
            cursor = parent.parentId;
          }
        }
        const [row] = await tx
          .update(departments)
          .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.parentId !== undefined && { parentId: input.parentId }),
            updatedAt: new Date(),
          })
          .where(eq(departments.id, id))
          .returning();
        return toDepartment(row);
      });
    },

    async deleteDepartment(id: string): Promise<void> {
      if (!isUuid(id)) throw notFound('department_not_found', `department ${id} not found`);
      await db.transaction(async (tx) => {
        const current = await tx.query.departments.findFirst({ where: eq(departments.id, id) });
        if (!current) throw notFound('department_not_found', `department ${id} not found`);
        const child = await tx.query.departments.findFirst({
          where: eq(departments.parentId, id),
        });
        const position = await tx.query.positions.findFirst({
          where: eq(positions.departmentId, id),
        });
        if (child || position) {
          throw conflict('department_has_dependents', 'department has child departments or positions');
        }
        await tx.delete(departments).where(eq(departments.id, id));
      });
    },

    async listPositions(departmentId?: string): Promise<Position[]> {
      if (departmentId && !isUuid(departmentId)) return [];
      const rows = departmentId
        ? await db
            .select()
            .from(positions)
            .where(eq(positions.departmentId, departmentId))
            .orderBy(asc(positions.name), asc(positions.id))
        : await db.select().from(positions).orderBy(asc(positions.name), asc(positions.id));
      return rows.map(toPosition);
    },

    async getPosition(id: string): Promise<Position> {
      return toPosition(await findPositionRow(id));
    },

    async createPosition(input: CreatePositionRequest): Promise<Position> {
      if (!isUuid(input.departmentId)) {
        throw notFound('department_not_found', `department ${input.departmentId} not found`);
      }
      return db.transaction(async (tx) => {
        const department = await tx.query.departments.findFirst({
          where: eq(departments.id, input.departmentId),
        });
        if (!department) {
          throw notFound('department_not_found', `department ${input.departmentId} not found`);
        }
        const [row] = await tx
          .insert(positions)
          .values({
            departmentId: input.departmentId,
            name: input.name,
            description: input.description,
            responsibilities: input.responsibilities ?? [],
            skillTags: input.skillTags ?? [],
            capabilityGrants: input.capabilityGrants ?? [],
          })
          .returning();
        return toPosition(row);
      });
    },

    async updatePosition(id: string, input: UpdatePositionRequest): Promise<Position> {
      if (!isUuid(id)) throw notFound('position_not_found', `position ${id} not found`);
      return db.transaction(async (tx) => {
        const current = await tx.query.positions.findFirst({ where: eq(positions.id, id) });
        if (!current) throw notFound('position_not_found', `position ${id} not found`);
        if (input.departmentId) {
          if (!isUuid(input.departmentId)) {
            throw notFound('department_not_found', `department ${input.departmentId} not found`);
          }
          const department = await tx.query.departments.findFirst({
            where: eq(departments.id, input.departmentId),
          });
          if (!department) {
            throw notFound('department_not_found', `department ${input.departmentId} not found`);
          }
        }
        const [row] = await tx
          .update(positions)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(positions.id, id))
          .returning();
        return toPosition(row);
      });
    },

    async deletePosition(id: string): Promise<void> {
      if (!isUuid(id)) throw notFound('position_not_found', `position ${id} not found`);
      await db.transaction(async (tx) => {
        const current = await tx.query.positions.findFirst({ where: eq(positions.id, id) });
        if (!current) throw notFound('position_not_found', `position ${id} not found`);
        const assignment = await tx.query.staffAssignments.findFirst({
          where: eq(staffAssignments.positionId, id),
        });
        if (assignment) {
          throw conflict('position_has_assignments', 'position has staff assignments');
        }
        await tx.delete(positions).where(eq(positions.id, id));
      });
    },

    async getTree(): Promise<DepartmentNode[]> {
      const [departmentRows, positionRows, leaderRows] = await Promise.all([
        db
          .select()
          .from(departments)
          .where(eq(departments.organizationId, DEFAULT_ORGANIZATION_ID))
          .orderBy(asc(departments.name), asc(departments.id)),
        db.select().from(positions).orderBy(asc(positions.name), asc(positions.id)),
        db
          .select({
            assignmentId: staffAssignments.id,
            participantId: participants.id,
            name: participants.name,
            positionId: positions.id,
            departmentId: positions.departmentId,
          })
          .from(staffAssignments)
          .innerJoin(positions, eq(staffAssignments.positionId, positions.id))
          .innerJoin(participants, eq(staffAssignments.staffParticipantId, participants.id))
          .where(
            and(
              eq(staffAssignments.active, true),
              eq(staffAssignments.isDepartmentLeader, true)
            )
          )
          .orderBy(asc(participants.name), asc(participants.id), asc(staffAssignments.id)),
      ]);
      const nodes = new Map<string, DepartmentNode>();
      for (const row of departmentRows) {
        nodes.set(row.id, {
          ...toDepartment(row),
          positions: positionRows
            .filter((position) => position.departmentId === row.id)
            .map(toPosition),
          leaders: leaderRows
            .filter((leader) => leader.departmentId === row.id)
            .map(({ assignmentId, participantId, name, positionId }) => ({
              assignmentId,
              participantId,
              name,
              positionId,
            })),
          children: [],
        });
      }
      const roots: DepartmentNode[] = [];
      for (const row of departmentRows) {
        const node = nodes.get(row.id)!;
        if (row.parentId) nodes.get(row.parentId)?.children.push(node);
        else roots.push(node);
      }
      return roots;
    },

    async listStaff(): Promise<StaffProfile[]> {
      const rows = await db
        .select({ profile: staffProfiles })
        .from(staffProfiles)
        .innerJoin(participants, eq(staffProfiles.participantId, participants.id))
        .orderBy(asc(participants.createdAt), asc(participants.id));
      return Promise.all(rows.map(({ profile }) => buildStaffProfile(profile)));
    },

    getStaff: getStaffProfile,

    async getAssignment(id: string): Promise<StaffAssignment> {
      if (!isUuid(id)) throw notFound('assignment_not_found', `assignment ${id} not found`);
      const row = await db.query.staffAssignments.findFirst({
        where: eq(staffAssignments.id, id),
      });
      if (!row) throw notFound('assignment_not_found', `assignment ${id} not found`);
      const position = await findPositionRow(row.positionId);
      return toAssignment(row, position.departmentId);
    },

    async createAssignment(
      participantId: string,
      input: CreateStaffAssignmentRequest
    ): Promise<StaffAssignment> {
      if (!isUuid(input.positionId)) {
        throw notFound('position_not_found', `position ${input.positionId} not found`);
      }
      return db.transaction(async (tx) => {
        const profile = await tx.query.staffProfiles.findFirst({
          where: eq(staffProfiles.participantId, participantId),
        });
        if (!profile) {
          throw invalid('participant_not_staff', `participant ${participantId} is not staff`);
        }
        const position = await tx.query.positions.findFirst({
          where: eq(positions.id, input.positionId),
        });
        if (!position) {
          throw notFound('position_not_found', `position ${input.positionId} not found`);
        }
        const active = input.active ?? true;
        const isDepartmentLeader = input.isDepartmentLeader ?? false;
        if (isDepartmentLeader && !active) {
          throw invalid(
            'invalid_department_leader',
            'a department leader assignment must be active'
          );
        }
        if (active) {
          const duplicate = await tx.query.staffAssignments.findFirst({
            where: and(
              eq(staffAssignments.staffParticipantId, participantId),
              eq(staffAssignments.positionId, input.positionId),
              eq(staffAssignments.active, true)
            ),
          });
          if (duplicate) {
            throw conflict('duplicate_assignment', 'active assignment already exists');
          }
        }
        const [row] = await tx
          .insert(staffAssignments)
          .values({
            staffParticipantId: participantId,
            positionId: input.positionId,
            active,
            isDepartmentLeader,
          })
          .returning();
        return toAssignment(row, position.departmentId);
      });
    },

    async updateAssignment(
      id: string,
      input: UpdateStaffAssignmentRequest
    ): Promise<StaffAssignment> {
      if (!isUuid(id)) throw notFound('assignment_not_found', `assignment ${id} not found`);
      return db.transaction(async (tx) => {
        const current = await tx.query.staffAssignments.findFirst({
          where: eq(staffAssignments.id, id),
        });
        if (!current) throw notFound('assignment_not_found', `assignment ${id} not found`);
        const active = input.active ?? current.active;
        const isDepartmentLeader = input.isDepartmentLeader ?? current.isDepartmentLeader;
        if (isDepartmentLeader && !active) {
          throw invalid(
            'invalid_department_leader',
            'a department leader assignment must be active'
          );
        }
        if (active && !current.active) {
          const duplicate = await tx.query.staffAssignments.findFirst({
            where: and(
              eq(staffAssignments.staffParticipantId, current.staffParticipantId),
              eq(staffAssignments.positionId, current.positionId),
              eq(staffAssignments.active, true),
              ne(staffAssignments.id, id)
            ),
          });
          if (duplicate) {
            throw conflict('duplicate_assignment', 'active assignment already exists');
          }
        }
        const [row] = await tx
          .update(staffAssignments)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(staffAssignments.id, id))
          .returning();
        const position = await tx.query.positions.findFirst({
          where: eq(positions.id, row.positionId),
        });
        if (!position) {
          throw notFound('position_not_found', `position ${row.positionId} not found`);
        }
        return toAssignment(row, position.departmentId);
      });
    },

    async deleteAssignment(id: string): Promise<void> {
      if (!isUuid(id)) throw notFound('assignment_not_found', `assignment ${id} not found`);
      const [row] = await db
        .delete(staffAssignments)
        .where(eq(staffAssignments.id, id))
        .returning();
      if (!row) throw notFound('assignment_not_found', `assignment ${id} not found`);
    },

    assertParticipantKindChange,
    reconcileParticipant,
  };
}

export type OrganizationRepository = ReturnType<typeof createOrganizationRepository>;
