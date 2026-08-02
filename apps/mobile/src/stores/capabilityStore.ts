import { create } from 'zustand';
import type {
  CapabilityName,
  Department,
  Position,
  StaffProfile,
} from '@logact-pub/opc-protocol';
import { organizationApi } from '../api/http';
import { departmentIsWithin } from '../utils/organization';

const LEADER_CAPABILITIES = new Set<CapabilityName>([
  'department.manage',
  'position.manage',
  'staff.manage',
  'participant.manage',
  'agent.manage',
  'room.manage',
  'room.members.manage',
  'task.manage',
]);

interface CapabilityTarget {
  departmentId?: string;
  participantId?: string;
  self?: boolean;
}

export interface CapabilityState {
  participantId: string | null;
  staff: StaffProfile | null;
  departments: Department[];
  positions: Position[];
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
  hydrate: (participantId: string, force?: boolean) => Promise<void>;
  reset: () => void;
  can: (capability: CapabilityName, target?: CapabilityTarget) => boolean;
}

let hydrationSequence = 0;

export function resolveCapability(
  participantId: string,
  staff: StaffProfile | null,
  positions: Position[],
  departments: Department[],
  capability: CapabilityName,
  target: CapabilityTarget = {},
): boolean {
  if (!staff) return false;
  if (staff.isOwner) return true;
  const positionById = new Map(
    positions.map(position => [position.id, position]),
  );

  for (const assignment of staff.assignments) {
    if (!assignment.active) continue;
    if (
      assignment.isDepartmentLeader &&
      LEADER_CAPABILITIES.has(capability) &&
      target.departmentId &&
      departmentIsWithin(
        departments,
        assignment.departmentId,
        target.departmentId,
      )
    ) {
      return true;
    }
    const position = positionById.get(assignment.positionId);
    for (const grant of position?.capabilityGrants ?? []) {
      if (grant.capability !== capability) continue;
      switch (grant.scope.type) {
        case 'organization':
          return true;
        case 'self':
          if (target.self || target.participantId === participantId)
            return true;
          break;
        case 'department':
          if (target.departmentId === assignment.departmentId) return true;
          break;
        case 'department_subtree':
          if (
            target.departmentId &&
            departmentIsWithin(
              departments,
              assignment.departmentId,
              target.departmentId,
            )
          ) {
            return true;
          }
          break;
      }
    }
  }
  return false;
}

export const useCapabilityStore = create<CapabilityState>((set, get) => ({
  participantId: null,
  staff: null,
  departments: [],
  positions: [],
  isLoading: false,
  isReady: false,
  error: null,

  hydrate: async (participantId, force = false) => {
    const current = get();
    if (
      !force &&
      current.participantId === participantId &&
      (current.isReady || current.isLoading)
    ) {
      return;
    }
    const sequence = ++hydrationSequence;
    set({ participantId, isLoading: true, isReady: false, error: null });
    try {
      const [{ staff }, { departments }, { positions }] = await Promise.all([
        organizationApi.getStaff(participantId),
        organizationApi.listDepartments(),
        organizationApi.listPositions(),
      ]);
      if (
        get().participantId !== participantId ||
        sequence !== hydrationSequence
      )
        return;
      set({ staff, departments, positions, isLoading: false, isReady: true });
    } catch (error) {
      if (
        get().participantId !== participantId ||
        sequence !== hydrationSequence
      )
        return;
      set({
        staff: null,
        departments: [],
        positions: [],
        isLoading: false,
        isReady: true,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load capabilities',
      });
    }
  },

  reset: () => {
    hydrationSequence += 1;
    set({
      participantId: null,
      staff: null,
      departments: [],
      positions: [],
      isLoading: false,
      isReady: false,
      error: null,
    });
  },

  can: (capability, target) => {
    const state = get();
    if (!state.participantId) return false;
    return resolveCapability(
      state.participantId,
      state.staff,
      state.positions,
      state.departments,
      capability,
      target,
    );
  },
}));
