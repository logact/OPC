import type {
  AuthorizationChannel,
  AuthorizationDecision,
  AuthorizationResource,
  CapabilityGrant,
  CapabilityName,
  CapabilityScope,
  Participant,
  Room,
} from '@logact-pub/opc-protocol';
import type {
  AuthorizationAuditRepository,
  OrganizationRepository,
  ParticipantRepository,
} from '@opc/database';

export class AuthorizationDeniedError extends Error {
  readonly code = 'forbidden' as const;
  readonly status = 403 as const;

  constructor(readonly decision: AuthorizationDecision) {
    super(decision.reason);
    this.name = 'AuthorizationDeniedError';
  }
}

interface AssignmentGrant {
  assignmentId: string;
  departmentId: string;
  leader: boolean;
  grant: CapabilityGrant;
}

interface ActorPolicy {
  actorId: string;
  owner: boolean;
  assignments: AssignmentGrant[];
  leaderDepartments: string[];
}

const LEADER_CAPABILITIES = new Set<CapabilityName>([
  'department.manage',
  'position.manage',
  'staff.manage',
  'participant.manage',
  'agent.manage',
  'room.manage',
  'room.members.manage',
]);

function resourceDepartmentIds(resource: AuthorizationResource): string[] {
  switch (resource.type) {
    case 'department':
    case 'position':
      return [resource.departmentId];
    case 'staff':
    case 'participant':
    case 'agent':
      return resource.departmentIds;
    case 'room':
    case 'message':
      return resource.departmentId ? [resource.departmentId] : [];
    case 'organization':
    case 'authorization_audit':
      return [];
  }
}

function isSelf(actorId: string, resource: AuthorizationResource): boolean {
  switch (resource.type) {
    case 'staff':
    case 'participant':
    case 'agent':
      return resource.participantId === actorId;
    case 'room':
    case 'message':
      return resource.creatorId === actorId || resource.participantIds.includes(actorId);
    case 'organization':
    case 'department':
    case 'position':
    case 'authorization_audit':
      return false;
  }
}

export function participantResource(
  participant: Participant,
  departmentIds: string[]
): AuthorizationResource {
  const common = {
    id: participant.id,
    participantId: participant.id,
    departmentIds,
  };
  return participant.kind === 'agent'
    ? { type: 'agent', ...common, ...(participant.gatewayId ? { gatewayId: participant.gatewayId } : {}) }
    : { type: 'participant', ...common };
}

export function roomResource(room: Room): AuthorizationResource {
  return {
    type: 'room',
    id: room.id,
    creatorId: room.creatorId,
    roomType: room.type,
    departmentId: room.departmentId,
    participantIds: room.participantIds,
  };
}

export function messageResource(room: Room, messageId: string): AuthorizationResource {
  return {
    type: 'message',
    id: messageId,
    roomId: room.id,
    creatorId: room.creatorId,
    departmentId: room.departmentId,
    participantIds: room.participantIds,
  };
}

export function createAuthorizationService({
  organizationRepo,
  participantRepo,
  auditRepo,
}: {
  organizationRepo: OrganizationRepository;
  participantRepo: ParticipantRepository;
  auditRepo: AuthorizationAuditRepository;
}) {
  async function actorPolicy(actorId: string): Promise<ActorPolicy> {
    try {
      const staff = await organizationRepo.getStaff(actorId);
      const assignments: AssignmentGrant[] = [];
      const leaderDepartments: string[] = [];
      for (const assignment of staff.assignments) {
        if (!assignment.active) continue;
        if (assignment.isDepartmentLeader) leaderDepartments.push(assignment.departmentId);
        const position = await organizationRepo.getPosition(assignment.positionId);
        for (const grant of position.capabilityGrants) {
          assignments.push({
            assignmentId: assignment.id,
            departmentId: assignment.departmentId,
            leader: assignment.isDepartmentLeader,
            grant,
          });
        }
      }
      return { actorId, owner: staff.isOwner, assignments, leaderDepartments };
    } catch {
      return { actorId, owner: false, assignments: [], leaderDepartments: [] };
    }
  }

  async function departmentIsWithin(rootId: string, targetId: string): Promise<boolean> {
    if (rootId === targetId) return true;
    const departments = await organizationRepo.listDepartments();
    const byId = new Map(departments.map((department) => [department.id, department]));
    let cursor = byId.get(targetId)?.parentId ?? null;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (cursor === rootId) return true;
      visited.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return false;
  }

  async function scopeMatches(
    actorId: string,
    sourceDepartmentId: string,
    scope: CapabilityScope,
    resource: AuthorizationResource
  ): Promise<boolean> {
    if (scope.type === 'organization') return true;
    if (scope.type === 'self') return isSelf(actorId, resource);
    const targets = resourceDepartmentIds(resource);
    if (targets.length === 0) return false;
    if (scope.type === 'department') return targets.includes(sourceDepartmentId);
    return (
      await Promise.all(targets.map((target) => departmentIsWithin(sourceDepartmentId, target)))
    ).some(Boolean);
  }

  async function evaluate(
    actorId: string,
    action: CapabilityName,
    resource: AuthorizationResource
  ): Promise<AuthorizationDecision> {
    const policy = await actorPolicy(actorId);
    const membershipProtected = action === 'message.read' || action === 'message.send';
    if (membershipProtected && (resource.type === 'room' || resource.type === 'message')) {
      // 房间成员关系本身就是 IM 的授权模型（issue #126）：成员即可读写消息，
      // 无需额外的 position grant；非成员一律拒绝。
      if (!resource.participantIds.includes(actorId)) {
        return { allowed: false, action, reason: 'room membership is required for messaging' };
      }
      return { allowed: true, action, reason: 'room membership is sufficient for messaging' };
    }
    if (
      resource.type === 'room' &&
      resource.roomType === 'direct' &&
      action === 'room.create' &&
      !resource.participantIds.includes(actorId)
    ) {
      return { allowed: false, action, reason: 'a direct-room creator must be a member' };
    }
    if (
      resource.type === 'room' &&
      resource.roomType === 'direct' &&
      action === 'room.members.manage'
    ) {
      return { allowed: false, action, reason: 'direct-room membership is immutable' };
    }
    if (
      resource.type === 'room' &&
      resource.roomType === 'direct' &&
      (action === 'room.read' || action === 'room.manage') &&
      !resource.participantIds.includes(actorId)
    ) {
      return { allowed: false, action, reason: 'direct rooms are visible only to their members' };
    }
    if (policy.owner) return { allowed: true, action, reason: 'organization Owner' };

    for (const assignment of policy.assignments) {
      if (assignment.grant.capability !== action) continue;
      if (
        await scopeMatches(
          actorId,
          assignment.departmentId,
          assignment.grant.scope,
          resource
        )
      ) {
        return {
          allowed: true,
          action,
          reason: 'matched active position grant',
          matchedAssignmentId: assignment.assignmentId,
          matchedScope: assignment.grant.scope,
        };
      }
    }

    if (LEADER_CAPABILITIES.has(action)) {
      const targets = resourceDepartmentIds(resource);
      for (const leaderDepartment of policy.leaderDepartments) {
        if (
          targets.length > 0 &&
          (
            await Promise.all(
              targets.map((target) => departmentIsWithin(leaderDepartment, target))
            )
          ).some(Boolean)
        ) {
          return {
            allowed: true,
            action,
            reason: 'department leader subtree authority',
            matchedScope: { type: 'department_subtree' },
          };
        }
      }
    }
    return { allowed: false, action, reason: 'no active grant covers the resource' };
  }

  async function record(
    actorId: string | null,
    channel: AuthorizationChannel,
    decision: AuthorizationDecision,
    resource: AuthorizationResource,
    options?: { claimedActorId?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    await auditRepo.append({
      actorId,
      claimedActorId: options?.claimedActorId,
      channel,
      action: decision.action,
      resourceType: resource.type,
      resourceId: resource.id,
      departmentId: resourceDepartmentIds(resource)[0],
      outcome: decision.allowed ? 'allowed' : 'denied',
      reason: decision.reason,
      metadata: options?.metadata,
    });
  }

  async function authorize(
    actorId: string,
    action: CapabilityName,
    resource: AuthorizationResource,
    channel: AuthorizationChannel = 'http',
    options?: { claimedActorId?: string; metadata?: Record<string, unknown> }
  ): Promise<AuthorizationDecision> {
    const decision = await evaluate(actorId, action, resource);
    await record(actorId, channel, decision, resource, options);
    return decision;
  }

  async function deny(
    actorId: string,
    action: CapabilityName,
    resource: AuthorizationResource,
    reason: string,
    channel: AuthorizationChannel = 'http',
    options?: { claimedActorId?: string; metadata?: Record<string, unknown> }
  ): Promise<AuthorizationDecision> {
    const decision: AuthorizationDecision = { allowed: false, action, reason };
    await record(actorId, channel, decision, resource, options);
    return decision;
  }

  async function allow(
    actorId: string,
    action: CapabilityName,
    resource: AuthorizationResource,
    reason: string,
    channel: AuthorizationChannel = 'http',
    options?: { claimedActorId?: string; metadata?: Record<string, unknown> }
  ): Promise<AuthorizationDecision> {
    const decision: AuthorizationDecision = { allowed: true, action, reason };
    await record(actorId, channel, decision, resource, options);
    return decision;
  }

  async function require(
    actorId: string,
    action: CapabilityName,
    resource: AuthorizationResource,
    channel: AuthorizationChannel = 'http',
    options?: { claimedActorId?: string; metadata?: Record<string, unknown> }
  ): Promise<AuthorizationDecision> {
    const decision = await authorize(actorId, action, resource, channel, options);
    if (!decision.allowed) throw new AuthorizationDeniedError(decision);
    return decision;
  }

  async function participantDepartmentIds(participantId: string): Promise<string[]> {
    try {
      const staff = await organizationRepo.getStaff(participantId);
      return [
        ...new Set(
          staff.assignments
            .filter((assignment) => assignment.active)
            .map((assignment) => assignment.departmentId)
        ),
      ];
    } catch {
      return [];
    }
  }

  async function canDelegate(
    actorId: string,
    grants: CapabilityGrant[],
    targetDepartmentId: string
  ): Promise<boolean> {
    if (grants.length === 0) return true;
    const policy = await actorPolicy(actorId);
    if (policy.owner) return true;
    const targetResource: AuthorizationResource = {
      type: 'position',
      id: 'delegated-position',
      departmentId: targetDepartmentId,
    };
    const delegate = await evaluate(actorId, 'capability.delegate', targetResource);
    if (!delegate.allowed) return false;

    for (const requested of grants) {
      let covered = false;
      for (const held of policy.assignments) {
        if (held.grant.capability !== requested.capability) continue;
        if (!await scopeMatches(actorId, held.departmentId, held.grant.scope, targetResource)) {
          continue;
        }
        if (requested.scope.type === 'organization') {
          covered = held.grant.scope.type === 'organization';
        } else if (requested.scope.type === 'department_subtree') {
          covered =
            held.grant.scope.type === 'organization' ||
            (held.grant.scope.type === 'department_subtree' &&
              await departmentIsWithin(held.departmentId, targetDepartmentId));
        } else if (requested.scope.type === 'department') {
          covered = held.grant.scope.type !== 'self';
        } else {
          covered = true;
        }
        if (covered) break;
      }
      if (!covered) return false;
    }
    return true;
  }

  async function requireDelegation(
    actorId: string,
    grants: CapabilityGrant[],
    targetDepartmentId: string
  ): Promise<void> {
    if (await canDelegate(actorId, grants, targetDepartmentId)) return;
    const resource: AuthorizationResource = {
      type: 'position',
      id: 'delegated-position',
      departmentId: targetDepartmentId,
    };
    const decision: AuthorizationDecision = {
      allowed: false,
      action: 'capability.delegate',
      reason: 'delegation exceeds the actor capability ceiling',
    };
    await record(actorId, 'http', decision, resource);
    throw new AuthorizationDeniedError(decision);
  }

  return {
    authorize,
    allow,
    deny,
    require,
    evaluate,
    participantDepartmentIds,
    canDelegate,
    requireDelegation,
    participantResource,
    roomResource,
    messageResource,
    participantRepo,
  };
}

export type AuthorizationService = ReturnType<typeof createAuthorizationService>;

export interface ServerEnv {
  Variables: {
    actorId?: string;
    credentialActorId?: string;
  };
}
