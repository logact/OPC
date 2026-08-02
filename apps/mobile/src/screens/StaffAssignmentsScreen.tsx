import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateStaffAssignmentRequest } from '@logact-pub/opc-protocol';
import { organizationApi, participantsApi } from '../api/http';
import {
  ActionButton,
  Card,
  Chip,
  EmptyState,
  InlineNotice,
  LoadingState,
  SectionTitle,
  Toast,
  WorkflowHeader,
  WorkflowScreen,
  workflowStyles,
} from '../components/WorkflowUI';
import { useCapabilityStore } from '../stores/capabilityStore';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function StaffAssignmentsScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { departmentId } = route.params as { departmentId: string };
  const can = useCapabilityStore(state => state.can);
  const queryClient = useQueryClient();
  const participantsQuery = useQuery({
    queryKey: ['participants'],
    queryFn: () => participantsApi.list(),
  });
  const positionsQuery = useQuery({
    queryKey: ['organization', 'positions'],
    queryFn: () => organizationApi.listPositions(),
  });
  const staffQuery = useQuery({
    queryKey: ['organization', 'staff'],
    queryFn: organizationApi.listStaff,
  });
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [leader, setLeader] = useState(false);
  const [choosingPosition, setChoosingPosition] = useState(false);

  const participants = (participantsQuery.data?.participants ?? []).filter(
    item => item.kind !== 'gateway',
  );
  const positions = (positionsQuery.data?.positions ?? []).filter(
    item => item.departmentId === departmentId,
  );
  const selectedProfile = staffQuery.data?.staff.find(
    item => item.participantId === participantId,
  );
  const positionById = useMemo(
    () =>
      new Map(
        (positionsQuery.data?.positions ?? []).map(item => [item.id, item]),
      ),
    [positionsQuery.data],
  );
  const departmentAssignments = (selectedProfile?.assignments ?? []).filter(
    assignment => assignment.departmentId === departmentId,
  );
  const assignedPositionIds = new Set(
    departmentAssignments.map(assignment => assignment.positionId),
  );
  const availablePositions = positions.filter(
    position => !assignedPositionIds.has(position.id),
  );
  const createMutation = useMutation({
    mutationFn: () =>
      organizationApi.createStaffAssignment(participantId!, {
        positionId: positionId!,
        active: true,
        isDepartmentLeader: leader,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      navigation.replace('DepartmentDetail', { departmentId });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: UpdateStaffAssignmentRequest;
    }) => organizationApi.updateStaffAssignment(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => organizationApi.deleteStaffAssignment(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });
  const queryError =
    participantsQuery.error ?? positionsQuery.error ?? staffQuery.error;
  const mutationError =
    createMutation.error ?? updateMutation.error ?? deleteMutation.error;
  const error = useRecoverableApiError(mutationError ?? queryError);
  const authorized = can('staff.manage', { departmentId });
  const loading =
    participantsQuery.isLoading ||
    positionsQuery.isLoading ||
    staffQuery.isLoading;

  return (
    <WorkflowScreen testID="screen-staff-assignments">
      <WorkflowHeader
        title="Staff assignments"
        onBack={() => navigation.goBack()}
      />
      {loading ? <LoadingState /> : null}
      {error && !mutationError ? (
        <InlineNotice
          message={error.message}
          onRetry={() => {
            void participantsQuery.refetch();
            void positionsQuery.refetch();
            void staffQuery.refetch();
          }}
        />
      ) : null}
      {!authorized ? (
        <InlineNotice message="You are not authorized to manage staff here." />
      ) : null}
      {authorized && !loading ? (
        <>
          <SectionTitle>Select staff</SectionTitle>
          {participants.map(participant => (
            <TouchableOpacity
              key={participant.id}
              testID={`staff-picker-${participant.id}`}
              onPress={() => {
                setParticipantId(participant.id);
                setPositionId(null);
                setLeader(false);
                setChoosingPosition(false);
              }}
            >
              <Card>
                <Text style={workflowStyles.title}>{participant.name}</Text>
                <Text style={workflowStyles.muted}>{participant.kind}</Text>
              </Card>
            </TouchableOpacity>
          ))}
          {participantId ? (
            <>
              <SectionTitle>Current positions</SectionTitle>
              {departmentAssignments.length === 0 ? (
                <EmptyState label="No positions" />
              ) : (
                departmentAssignments.map(assignment => (
                  <Card key={assignment.id}>
                    <Text style={workflowStyles.title}>
                      {positionById.get(assignment.positionId)?.name ??
                        assignment.positionId}
                    </Text>
                    <Text style={workflowStyles.muted}>
                      {assignment.active ? 'Active' : 'Inactive'}
                      {assignment.isDepartmentLeader
                        ? ' · Department leader'
                        : ''}
                    </Text>
                    <View style={workflowStyles.wrap}>
                      <Chip
                        label={assignment.active ? 'Set inactive' : 'Activate'}
                        testID={`staff-assignment-active-${assignment.id}`}
                        selected={assignment.active}
                        onPress={() =>
                          updateMutation.mutate({
                            id: assignment.id,
                            payload: assignment.active
                              ? {
                                  active: false,
                                  isDepartmentLeader: false,
                                }
                              : { active: true },
                          })
                        }
                      />
                      <Chip
                        label="Department leader"
                        testID={`staff-assignment-leader-${assignment.id}`}
                        selected={assignment.isDepartmentLeader}
                        onPress={() =>
                          updateMutation.mutate({
                            id: assignment.id,
                            payload: {
                              ...(assignment.active ? {} : { active: true }),
                              isDepartmentLeader:
                                !assignment.isDepartmentLeader,
                            },
                          })
                        }
                      />
                    </View>
                    <ActionButton
                      title="Remove assignment"
                      testID={`staff-assignment-remove-${assignment.id}`}
                      variant="secondary"
                      disabled={deleteMutation.isPending}
                      onPress={() => deleteMutation.mutate(assignment.id)}
                    />
                  </Card>
                ))
              )}
              <ActionButton
                title="Add position"
                testID="staff-assignment-add"
                variant="secondary"
                disabled={availablePositions.length === 0}
                onPress={() => setChoosingPosition(true)}
              />
              {choosingPosition
                ? availablePositions.map(position => (
                    <TouchableOpacity
                      key={position.id}
                      testID={`position-picker-${position.id}`}
                      onPress={() => {
                        setPositionId(position.id);
                        setChoosingPosition(false);
                      }}
                    >
                      <Card>
                        <Text style={workflowStyles.body}>{position.name}</Text>
                      </Card>
                    </TouchableOpacity>
                  ))
                : null}
              {positionId ? (
                <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
                  <Chip
                    label="Department leader"
                    testID="staff-assignment-leader"
                    selected={leader}
                    onPress={() => setLeader(value => !value)}
                  />
                </View>
              ) : null}
              <ActionButton
                title={createMutation.isPending ? 'Saving…' : 'Save assignment'}
                testID="staff-assignment-submit"
                disabled={!positionId || createMutation.isPending}
                onPress={() => createMutation.mutate()}
              />
            </>
          ) : null}
        </>
      ) : null}
      <Toast
        message={mutationError ? error?.message ?? 'Assignment failed' : null}
      />
    </WorkflowScreen>
  );
}
