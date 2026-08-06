import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { participantsApi, tasksApi } from '../api/http';
import { isConflictProblem } from '../api/errors';
import {
  ActionButton,
  Card,
  Field,
  InlineNotice,
  LoadingState,
  SectionTitle,
  Toast,
  WorkflowHeader,
  WorkflowScreen,
  workflowStyles,
} from '../components/WorkflowUI';
import { useAuth } from '../hooks/useAuth';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Direct assign / reassign (issue #130): pick any human or agent participant,
 * optionally record a reason, and confirm once. The server enforces
 * creator-only authorization; the recommendation flow and reviewer /
 * collaborator roles are gone.
 */
export function TaskAssignmentScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { taskId } = route.params as { taskId: string };
  const queryClient = useQueryClient();
  const { participantId } = useAuth();
  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId),
  });
  const participantsQuery = useQuery({
    queryKey: ['participants'],
    queryFn: () => participantsApi.list(),
  });
  const task = taskQuery.data?.task;
  const authorized = Boolean(task && task.creatorId === participantId);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (task && assigneeId === null) setAssigneeId(task.assigneeId);
  }, [task, assigneeId]);

  const candidates = (participantsQuery.data?.participants ?? []).filter(
    participant => participant.kind !== 'gateway',
  );
  const mutation = useMutation({
    mutationFn: () =>
      tasksApi.assign(taskId, {
        assigneeId: assigneeId!,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        idempotencyKey: `mobile-assign-${taskId}-${Date.now()}`,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigation.replace('TaskDetail', { taskId });
    },
  });
  const queryProblem = useRecoverableApiError(
    taskQuery.error ?? participantsQuery.error,
  );
  const mutationProblem = useRecoverableApiError(mutation.error);
  useEffect(() => {
    if (mutationProblem && isConflictProblem(mutationProblem)) {
      void taskQuery.refetch();
    }
  }, [mutationProblem, taskQuery.refetch]);
  const loading = taskQuery.isLoading || participantsQuery.isLoading;

  return (
    <WorkflowScreen testID="screen-task-assignment">
      <WorkflowHeader
        title="Assign task"
        onBack={() => navigation.goBack()}
      />
      {loading ? <LoadingState /> : null}
      {queryProblem ? (
        <InlineNotice
          message={queryProblem.message}
          onRetry={() => {
            void taskQuery.refetch();
            void participantsQuery.refetch();
          }}
        />
      ) : null}
      {!loading && !queryProblem && !authorized ? (
        <InlineNotice message="Only the task creator can assign this task." />
      ) : null}
      {!loading && !queryProblem && authorized ? (
        <>
          <SectionTitle>Assignee</SectionTitle>
          {candidates.map(participant => (
            <TouchableOpacity
              key={participant.id}
              testID={`assignee-option-${participant.id}`}
              onPress={() => setAssigneeId(participant.id)}
            >
              <Card>
                <Text style={workflowStyles.body}>
                  {participant.name}
                  {assigneeId === participant.id ? ' ✓' : ''}
                </Text>
                <Text style={workflowStyles.muted}>{participant.kind}</Text>
              </Card>
            </TouchableOpacity>
          ))}
          <Field
            label="Reason (optional)"
            testID="assignment-reason"
            value={reason}
            onChangeText={setReason}
          />
          <ActionButton
            title={mutation.isPending ? 'Assigning…' : 'Confirm assignment'}
            testID="assignment-confirm-submit"
            disabled={!assigneeId || mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </>
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
