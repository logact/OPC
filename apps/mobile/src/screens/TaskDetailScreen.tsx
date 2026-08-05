import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskMutationResponse } from '@logact-pub/opc-protocol';
import { participantsApi, roomsApi, tasksApi } from '../api/http';
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
import { useMqtt } from '../contexts/MqttContext';
import { useParticipantPresence } from '../hooks/useParticipantPresence';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { availableTaskActions, type TaskAction } from '../utils/taskActions';
import { presenceDisplay } from '../utils/presenceDisplay';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type FormCommand = 'block' | 'resume' | 'submit' | 'fail' | 'cancel';

const ACTION_LABELS: Record<TaskAction, string> = {
  edit: 'Edit',
  assign: 'Assign',
  start: 'Start',
  block: 'Block',
  resume: 'Resume',
  submit: 'Submit result',
  fail: 'Fail',
  cancel: 'Cancel',
};

function commandField(command: FormCommand): {
  label: string;
  testID: string;
  submitID: string;
} {
  switch (command) {
    case 'block':
      return {
        label: 'Reason for blocking',
        testID: 'task-block-reason',
        submitID: 'task-block-submit',
      };
    case 'resume':
      return {
        label: 'Reason for resuming',
        testID: 'task-resume-reason',
        submitID: 'task-resume-submit',
      };
    case 'submit':
      return {
        label: 'Result summary',
        testID: 'task-result-summary',
        submitID: 'task-result-submit',
      };
    case 'fail':
      return {
        label: 'Failure reason',
        testID: 'task-fail-reason',
        submitID: 'task-fail-submit',
      };
    case 'cancel':
      return {
        label: 'Cancellation reason',
        testID: 'task-cancel-reason',
        submitID: 'task-cancel-submit',
      };
  }
}

export function TaskDetailScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { taskId } = route.params as { taskId: string };
  const queryClient = useQueryClient();
  const { participantId } = useAuth();
  const { client, state: mqttState } = useMqtt();
  const livePresence = useParticipantPresence();
  const [command, setCommand] = useState<FormCommand | null>(null);
  const [commandValue, setCommandValue] = useState('');

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId),
  });
  const participantsQuery = useQuery({
    queryKey: ['participants'],
    queryFn: () => participantsApi.list(),
  });
  const roomId = taskQuery.data?.task.roomId ?? null;
  const roomHistoryQuery = useQuery({
    queryKey: ['task', taskId, 'room-history', roomId],
    queryFn: () => roomsApi.history(roomId!),
    enabled: Boolean(roomId),
  });

  useEffect(() => {
    if (!client || !roomId) return;
    client.subscribeRoom(roomId);
    const unsubscribe = client.onEvent(event => {
      if (
        (event.type === 'task.event' && event.taskId === taskId) ||
        (event.type === 'message.delivered' && event.message.roomId === roomId)
      ) {
        void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
        void queryClient.invalidateQueries({
          queryKey: ['task', taskId, 'room-history'],
        });
      }
    });
    return () => {
      unsubscribe();
      client.unsubscribeRoom(roomId);
    };
  }, [client, roomId, taskId, queryClient]);

  const mutation = useMutation({
    mutationFn: async ({
      action,
      value,
    }: {
      action: Exclude<TaskAction, 'edit' | 'assign'>;
      value?: string;
    }): Promise<TaskMutationResponse> => {
      const idempotencyKey = `mobile-${action}-${taskId}-${Date.now()}`;
      switch (action) {
        case 'start':
          return tasksApi.start(taskId, { idempotencyKey });
        case 'block':
          return tasksApi.block(taskId, {
            reason: value!.trim(),
            idempotencyKey,
          });
        case 'resume':
          return tasksApi.resume(taskId, {
            reason: value!.trim(),
            idempotencyKey,
          });
        case 'submit':
          return tasksApi.submit(taskId, {
            summary: value!.trim(),
            idempotencyKey,
          });
        case 'fail':
          return tasksApi.fail(taskId, {
            reason: value!.trim(),
            idempotencyKey,
          });
        case 'cancel':
          return tasksApi.cancel(taskId, {
            reason: value!.trim(),
            idempotencyKey,
          });
      }
    },
    onSuccess: async () => {
      setCommand(null);
      setCommandValue('');
      await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const queryError =
    taskQuery.error ?? participantsQuery.error ?? roomHistoryQuery.error;
  const queryProblem = useRecoverableApiError(queryError);
  const mutationProblem = useRecoverableApiError(mutation.error);

  useEffect(() => {
    if (mutationProblem && isConflictProblem(mutationProblem)) {
      void taskQuery.refetch();
    }
  }, [mutationProblem, taskQuery.refetch]);

  const task = taskQuery.data?.task;
  const participantById = new Map(
    (participantsQuery.data?.participants ?? []).map(item => [item.id, item]),
  );
  const people = useMemo(() => {
    if (!task) return [];
    const roles: { id: string; role: string }[] = [
      { id: task.creatorId, role: 'Creator' },
    ];
    if (task.assigneeId) roles.push({ id: task.assigneeId, role: 'Assignee' });
    return roles;
  }, [task]);
  const actions =
    task && participantId
      ? availableTaskActions({ task, participantId })
      : [];
  const narrative = (roomHistoryQuery.data?.messages ?? []).filter(message => {
    const opcTask = message.metadata?.opcTask;
    return (
      typeof opcTask === 'object' &&
      opcTask !== null &&
      'taskId' in opcTask &&
      (opcTask as { taskId: unknown }).taskId === taskId
    );
  });
  const progressEvents = (taskQuery.data?.events ?? []).filter(
    event => event.kind === 'progress',
  );

  const runAction = (action: TaskAction) => {
    if (action === 'edit') {
      navigation.navigate('TaskForm', { taskId });
      return;
    }
    if (action === 'assign') {
      navigation.navigate('TaskAssignment', { taskId });
      return;
    }
    if (action === 'start') {
      mutation.mutate({ action: 'start' });
      return;
    }
    setCommand(action);
    setCommandValue('');
  };

  const submitCommand = () => {
    if (!command || !commandValue.trim()) return;
    mutation.mutate({ action: command, value: commandValue });
  };

  return (
    <WorkflowScreen testID="screen-task-detail" scroll={false}>
      <WorkflowHeader
        title={task?.title ?? 'Task'}
        onBack={() => navigation.goBack()}
      />
      {mqttState !== 'connected' ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>
            Realtime offline · retry is available
          </Text>
        </View>
      ) : null}
      {taskQuery.isLoading || participantsQuery.isLoading ? (
        <LoadingState />
      ) : null}
      {queryProblem ? (
        <InlineNotice
          message={queryProblem.message}
          onRetry={() => void taskQuery.refetch()}
        />
      ) : null}
      {task ? (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <Card>
            <Text style={styles.taskTitle}>{task.title}</Text>
            <Text testID={`task-status-${task.status}`} style={styles.status}>
              {task.status.replaceAll('_', ' ')}
            </Text>
            <Text style={workflowStyles.body}>
              {task.description || 'No description'}
            </Text>
          </Card>

          <View style={styles.actions}>
            {actions.map(action => (
              <TouchableOpacity
                key={action}
                testID={`task-action-${action}`}
                style={[
                  styles.action,
                  (action === 'fail' || action === 'cancel') &&
                    styles.actionDanger,
                ]}
                onPress={() => runAction(action)}
              >
                <Text style={styles.actionText}>{ACTION_LABELS[action]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {command ? (
            <Card>
              <Field
                label={commandField(command).label}
                testID={commandField(command).testID}
                value={commandValue}
                onChangeText={setCommandValue}
                multiline={command === 'submit'}
              />
              <View style={{ marginHorizontal: -14 }}>
                <ActionButton
                  title={
                    mutation.isPending ? 'Saving…' : ACTION_LABELS[command]
                  }
                  testID={commandField(command).submitID}
                  disabled={mutation.isPending || !commandValue.trim()}
                  onPress={submitCommand}
                />
              </View>
            </Card>
          ) : null}

          <SectionTitle>People</SectionTitle>
          {people.map(({ id, role }) => {
            const participant = participantById.get(id);
            if (!participant) return null;
            const presence = livePresence[id] ?? participant.presence;
            return (
              <Card key={`${role}-${id}`}>
                <View style={styles.person}>
                  <View style={styles.flex}>
                    <Text style={workflowStyles.title}>{participant.name}</Text>
                    <Text style={workflowStyles.muted}>
                      {role} · {participant.kind}
                    </Text>
                  </View>
                  {participant.kind === 'agent' ? (
                    <Text
                      testID={`task-person-presence-${id}`}
                      style={{ color: presenceDisplay(presence).color }}
                    >
                      {presenceDisplay(presence).label}
                    </Text>
                  ) : null}
                </View>
              </Card>
            );
          })}

          <SectionTitle>History</SectionTitle>
          {taskQuery.data?.transitions.map(transition => (
            <Card key={transition.id}>
              <Text style={workflowStyles.body}>
                {transition.from ?? 'new'} → {transition.to}
              </Text>
              {transition.reason ? (
                <Text style={workflowStyles.muted}>{transition.reason}</Text>
              ) : null}
            </Card>
          ))}
          {taskQuery.data?.results.map(result => (
            <Card key={result.id}>
              <Text style={workflowStyles.body}>{result.summary}</Text>
              <Text style={workflowStyles.muted}>
                Submitted by{' '}
                {participantById.get(result.submittedBy)?.name ??
                  result.submittedBy}
              </Text>
            </Card>
          ))}
          {taskQuery.data?.events.map(event => (
            <Card
              key={event.id}
              testID={
                event.kind === 'progress' ? 'task-event-progress' : undefined
              }
            >
              <Text style={workflowStyles.body}>{event.message}</Text>
              <Text style={workflowStyles.muted}>{event.kind}</Text>
            </Card>
          ))}

          {progressEvents.length || narrative.length ? (
            <View testID="task-execution-progress">
              <SectionTitle>Execution progress</SectionTitle>
              {narrative.map(message => (
                <Card key={message.id}>
                  <Text style={workflowStyles.body}>
                    {message.content.body}
                  </Text>
                </Card>
              ))}
            </View>
          ) : null}
          {roomId ? (
            <TouchableOpacity
              testID="task-room-open"
              style={styles.roomLink}
              onPress={() =>
                navigation.navigate('Room', { roomId, roomName: task.title })
              }
            >
              <Text style={workflowStyles.link}>Open task room</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
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
  flex: { flex: 1 },
  content: { paddingBottom: 32 },
  taskTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  status: {
    color: theme.colors.accent,
    textTransform: 'uppercase',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 10,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  action: {
    backgroundColor: theme.colors.accent,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionDanger: { backgroundColor: theme.colors.danger },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roomLink: {
    margin: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: 10,
    alignItems: 'center',
  },
  offline: { padding: 7, backgroundColor: '#322711', alignItems: 'center' },
  offlineText: { color: theme.colors.warning, fontSize: 11 },
});
