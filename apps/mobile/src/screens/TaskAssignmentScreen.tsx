import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationApi, participantsApi, tasksApi } from '../api/http';
import { isConflictProblem } from '../api/errors';
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
import { useParticipantPresence } from '../hooks/useParticipantPresence';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { presenceDisplay } from '../utils/presenceDisplay';
import { departmentIsWithin, flattenDepartments } from '../utils/organization';
import { theme } from '../theme';
import { useCapabilityStore } from '../stores/capabilityStore';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Picker = 'collaborators' | 'reviewer' | null;

export function TaskAssignmentScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { taskId } = route.params as { taskId: string };
  const queryClient = useQueryClient();
  const livePresence = useParticipantPresence();
  const can = useCapabilityStore(state => state.can);
  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId),
  });
  const task = taskQuery.data?.task;
  const authorized = Boolean(
    task && can('task.assign', { departmentId: task.departmentId }),
  );
  const recommendationsQuery = useQuery({
    queryKey: ['task', taskId, 'recommendations'],
    queryFn: () => tasksApi.recommend(taskId),
    enabled: authorized,
  });
  const participantsQuery = useQuery({
    queryKey: ['participants'],
    queryFn: () => participantsApi.list(),
    enabled: authorized,
  });
  const staffQuery = useQuery({
    queryKey: ['organization', 'staff'],
    queryFn: organizationApi.listStaff,
    enabled: authorized,
  });
  const treeQuery = useQuery({
    queryKey: ['organization', 'tree'],
    queryFn: organizationApi.tree,
    enabled: authorized,
  });
  const departments = useMemo(
    () => flattenDepartments(treeQuery.data?.departments ?? []),
    [treeQuery.data],
  );
  const participantById = new Map(
    (participantsQuery.data?.participants ?? []).map(item => [item.id, item]),
  );
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [confirming, setConfirming] = useState(false);

  const eligibleStaffIds = new Set(
    (staffQuery.data?.staff ?? [])
      .filter(
        profile =>
          task &&
          profile.assignments.some(
            assignment =>
              assignment.active &&
              departmentIsWithin(
                departments,
                task.departmentId,
                assignment.departmentId,
              ),
          ),
      )
      .map(profile => profile.participantId),
  );
  const roleParticipants = (participantsQuery.data?.participants ?? []).filter(
    participant =>
      participant.kind !== 'gateway' && eligibleStaffIds.has(participant.id),
  );
  const mutation = useMutation({
    mutationFn: () =>
      tasksApi.assign(taskId, {
        assigneeId: assigneeId!,
        collaboratorIds,
        reviewerId: reviewerId!,
        idempotencyKey: `mobile-assign-${taskId}-${Date.now()}`,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigation.replace('TaskDetail', { taskId });
    },
  });
  const queryError =
    recommendationsQuery.error ??
    taskQuery.error ??
    participantsQuery.error ??
    staffQuery.error ??
    treeQuery.error;
  const queryProblem = useRecoverableApiError(queryError);
  const mutationProblem = useRecoverableApiError(mutation.error);
  useEffect(() => {
    if (mutationProblem && isConflictProblem(mutationProblem)) {
      void taskQuery.refetch();
      void recommendationsQuery.refetch();
    }
  }, [mutationProblem, taskQuery.refetch, recommendationsQuery.refetch]);
  const loading =
    taskQuery.isLoading ||
    recommendationsQuery.isLoading ||
    participantsQuery.isLoading ||
    staffQuery.isLoading ||
    treeQuery.isLoading;

  const selectRole = (participantId: string) => {
    if (picker === 'collaborators') {
      setCollaboratorIds(current =>
        current.includes(participantId)
          ? current.filter(id => id !== participantId)
          : [...current, participantId],
      );
      setPicker(null);
    } else if (picker === 'reviewer') {
      setReviewerId(participantId);
      setPicker(null);
    }
  };

  return (
    <WorkflowScreen testID="screen-task-assignment">
      <WorkflowHeader
        title={confirming ? 'Confirm assignment' : 'Recommendations'}
        onBack={() => (confirming ? setConfirming(false) : navigation.goBack())}
      />
      {loading ? <LoadingState /> : null}
      {queryProblem ? (
        <InlineNotice
          message={queryProblem.message}
          onRetry={() => {
            void taskQuery.refetch();
            void recommendationsQuery.refetch();
            void participantsQuery.refetch();
            void staffQuery.refetch();
            void treeQuery.refetch();
          }}
        />
      ) : null}
      {!loading && !queryProblem && !authorized ? (
        <InlineNotice message="You are not authorized to assign this task." />
      ) : null}
      {!loading && !queryProblem && authorized && !confirming ? (
        <>
          <SectionTitle>Recommended assignee</SectionTitle>
          {(recommendationsQuery.data?.recommendations.length ?? 0) === 0 ? (
            <EmptyState label="No eligible candidates" />
          ) : null}
          {recommendationsQuery.data?.recommendations.map(candidate => {
            const participant = participantById.get(candidate.participantId);
            const presence =
              livePresence[candidate.participantId] ?? participant?.presence;
            return (
              <Card
                key={candidate.participantId}
                testID={`candidate-item-${candidate.participantId}`}
              >
                <View style={styles.candidateTop}>
                  <View style={styles.flex}>
                    <Text style={workflowStyles.title}>{candidate.name}</Text>
                    <Text style={workflowStyles.muted}>
                      {candidate.participantKind.toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    testID={`candidate-score-${candidate.participantId}`}
                    style={styles.score}
                  >
                    {candidate.score}
                  </Text>
                </View>
                <Text
                  testID={`candidate-availability-${candidate.participantId}`}
                  style={[
                    workflowStyles.muted,
                    { color: presenceDisplay(presence).color },
                  ]}
                >
                  {candidate.availability}
                </Text>
                <Text
                  testID={`candidate-presence-${candidate.participantId}`}
                  style={workflowStyles.muted}
                >
                  {presenceDisplay(presence).label}
                </Text>
                <Text
                  testID={`candidate-skills-${candidate.participantId}`}
                  style={workflowStyles.muted}
                >
                  {candidate.matchedSkillTags.join(' · ') ||
                    'No required skills'}
                </Text>
                <View testID={`candidate-reasons-${candidate.participantId}`}>
                  {candidate.reasons.map(reason => (
                    <Text key={reason.code} style={workflowStyles.muted}>
                      {reason.detail}
                    </Text>
                  ))}
                </View>
                <View style={{ marginHorizontal: -14 }}>
                  <ActionButton
                    title={
                      assigneeId === candidate.participantId
                        ? 'Selected'
                        : 'Select'
                    }
                    testID={`candidate-select-${candidate.participantId}`}
                    variant="secondary"
                    onPress={() => setAssigneeId(candidate.participantId)}
                  />
                </View>
              </Card>
            );
          })}

          <SectionTitle>Other roles</SectionTitle>
          <TouchableOpacity
            testID="assignment-collaborators"
            onPress={() => setPicker('collaborators')}
          >
            <Card>
              <Text style={workflowStyles.body}>
                Collaborators:{' '}
                {collaboratorIds
                  .map(id => participantById.get(id)?.name)
                  .filter(Boolean)
                  .join(', ') || 'None'}
              </Text>
            </Card>
          </TouchableOpacity>
          <TouchableOpacity
            testID="assignment-reviewer"
            onPress={() => setPicker('reviewer')}
          >
            <Card>
              <Text style={workflowStyles.body}>
                Reviewer:{' '}
                {reviewerId
                  ? participantById.get(reviewerId)?.name
                  : 'Choose reviewer'}
              </Text>
            </Card>
          </TouchableOpacity>
          {picker
            ? roleParticipants
                .filter(
                  participant =>
                    picker !== 'reviewer' || participant.kind === 'human',
                )
                .filter(
                  participant =>
                    participant.id !== assigneeId &&
                    !collaboratorIds.includes(participant.id),
                )
                .map(participant => (
                  <TouchableOpacity
                    key={participant.id}
                    testID={`participant-option-${participant.id}`}
                    onPress={() => selectRole(participant.id)}
                  >
                    <Card>
                      <Text style={workflowStyles.body}>
                        {participant.name}
                      </Text>
                      <Text style={workflowStyles.muted}>
                        {participant.kind}
                      </Text>
                    </Card>
                  </TouchableOpacity>
                ))
            : null}
          <ActionButton
            title="Review assignment"
            testID="assignment-review"
            disabled={!assigneeId || !reviewerId}
            onPress={() => setConfirming(true)}
          />
        </>
      ) : null}
      {confirming ? (
        <View testID="assignment-confirmation">
          <SectionTitle>Explicit human confirmation</SectionTitle>
          <Card testID={`assignment-confirm-assignee-${assigneeId}`}>
            <Text style={workflowStyles.body}>
              Assignee · {participantById.get(assigneeId ?? '')?.name}
            </Text>
          </Card>
          {collaboratorIds.map(id => (
            <Card key={id} testID={`assignment-confirm-collaborator-${id}`}>
              <Text style={workflowStyles.body}>
                Collaborator · {participantById.get(id)?.name}
              </Text>
            </Card>
          ))}
          <Card testID={`assignment-confirm-reviewer-${reviewerId}`}>
            <Text style={workflowStyles.body}>
              Reviewer · {participantById.get(reviewerId ?? '')?.name}
            </Text>
          </Card>
          <Text style={styles.confirmText}>
            By confirming, you are making the server-authoritative accountable
            assignment.
          </Text>
          <ActionButton
            title={mutation.isPending ? 'Assigning…' : 'Confirm assignment'}
            testID="assignment-confirm-submit"
            disabled={mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </View>
      ) : null}
      <Toast
        message={
          mutationProblem
            ? isConflictProblem(mutationProblem)
              ? 'Task changed on the server. Refreshed.'
              : mutationProblem.message
            : null
        }
      />
    </WorkflowScreen>
  );
}

const styles = StyleSheet.create({
  candidateTop: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  score: { color: theme.colors.accent2, fontSize: 18, fontWeight: '800' },
  confirmText: {
    margin: 14,
    color: theme.colors.warning,
    fontSize: 12,
    lineHeight: 18,
  },
});
