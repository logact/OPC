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

export function TaskFormScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { taskId } = (route.params ?? {}) as { taskId?: string };
  const queryClient = useQueryClient();
  const { participantId } = useAuth();
  const participantsQuery = useQuery({
    queryKey: ['participants'],
    queryFn: () => participantsApi.list(),
    enabled: !taskId,
  });
  const detailQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId!),
    enabled: Boolean(taskId),
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    const task = detailQuery.data?.task;
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
  }, [detailQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (taskId) {
        return tasksApi.update(taskId, {
          title: title.trim(),
          description,
        });
      }
      return tasksApi.create({
        title: title.trim(),
        description,
        ...(assigneeId ? { assigneeId } : {}),
      });
    },
    onSuccess: async ({ task }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
      ]);
      navigation.replace('TaskDetail', { taskId: task.id });
    },
  });
  const error = useRecoverableApiError(
    mutation.error ?? participantsQuery.error ?? detailQuery.error,
  );
  useEffect(() => {
    if (mutation.error && error && isConflictProblem(error)) {
      void detailQuery.refetch();
    }
  }, [mutation.error, error, detailQuery.refetch]);
  const task = detailQuery.data?.task;
  // Anyone can create a draft (issue #130); editing stays creator-only and is
  // additionally restricted to drafts server-side.
  const canSubmit = !taskId || Boolean(task && task.creatorId === participantId);
  const loading = participantsQuery.isLoading || detailQuery.isLoading;
  const candidates = (participantsQuery.data?.participants ?? []).filter(
    participant => participant.kind !== 'gateway',
  );
  const assignee = candidates.find(item => item.id === assigneeId);

  const submit = () => {
    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }
    setTitleError(null);
    mutation.mutate();
  };

  return (
    <WorkflowScreen testID="screen-task-form">
      <WorkflowHeader
        title={taskId ? 'Edit task' : 'Create task'}
        onBack={() => navigation.goBack()}
      />
      {loading ? <LoadingState /> : null}
      {error && !mutation.error ? (
        <InlineNotice message={error.message} />
      ) : null}
      {!loading && !canSubmit ? (
        <InlineNotice message="You are not authorized to edit this task." />
      ) : null}
      {!loading && canSubmit ? (
        <>
          <Field
            label="Title"
            testID="task-form-title"
            value={title}
            onChangeText={setTitle}
          />
          {titleError ? (
            <Text
              testID="task-form-error-title"
              style={{ color: '#ef4444', marginHorizontal: 14, marginTop: 5 }}
            >
              {titleError}
            </Text>
          ) : null}
          <Field
            label="Description"
            testID="task-form-description"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          {!taskId ? (
            <>
              <SectionTitle>Assignee (optional)</SectionTitle>
              <TouchableOpacity
                testID="task-form-assignee"
                onPress={() => setPickerOpen(open => !open)}
              >
                <Card>
                  <Text style={workflowStyles.body}>
                    {assignee
                      ? `${assignee.name} · ${assignee.kind}`
                      : 'No assignee · keep as draft'}
                  </Text>
                </Card>
              </TouchableOpacity>
              {pickerOpen ? (
                <>
                  <TouchableOpacity
                    testID="task-form-assignee-none"
                    onPress={() => {
                      setAssigneeId(null);
                      setPickerOpen(false);
                    }}
                  >
                    <Card>
                      <Text style={workflowStyles.body}>No assignee</Text>
                    </Card>
                  </TouchableOpacity>
                  {candidates.map(participant => (
                    <TouchableOpacity
                      key={participant.id}
                      testID={`task-form-assignee-option-${participant.id}`}
                      onPress={() => {
                        setAssigneeId(participant.id);
                        setPickerOpen(false);
                      }}
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
                  ))}
                </>
              ) : null}
            </>
          ) : null}
          <ActionButton
            title={mutation.isPending ? 'Saving…' : 'Save task'}
            testID="task-form-submit"
            disabled={mutation.isPending}
            onPress={submit}
          />
        </>
      ) : null}
      <Toast
        message={
          mutation.error
            ? error && isConflictProblem(error)
              ? 'Task changed on the server. Refreshed.'
              : error?.message ?? 'Save failed'
            : null
        }
      />
    </WorkflowScreen>
  );
}
