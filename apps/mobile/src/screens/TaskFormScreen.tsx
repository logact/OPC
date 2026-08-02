import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskTarget } from '@logact-pub/opc-protocol';
import { organizationApi, participantsApi, tasksApi } from '../api/http';
import { isConflictProblem } from '../api/errors';
import {
  ActionButton,
  Card,
  Chip,
  Field,
  InlineNotice,
  LoadingState,
  SectionTitle,
  Toast,
  WorkflowHeader,
  WorkflowScreen,
  workflowStyles,
} from '../components/WorkflowUI';
import { useCapabilityStore } from '../stores/capabilityStore';
import { useAuth } from '../hooks/useAuth';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { departmentIsWithin, flattenDepartments } from '../utils/organization';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function TaskFormScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { taskId } = (route.params ?? {}) as { taskId?: string };
  const queryClient = useQueryClient();
  const { participantId } = useAuth();
  const can = useCapabilityStore(state => state.can);
  const treeQuery = useQuery({
    queryKey: ['organization', 'tree'],
    queryFn: organizationApi.tree,
  });
  const positionsQuery = useQuery({
    queryKey: ['organization', 'positions'],
    queryFn: () => organizationApi.listPositions(),
  });
  const participantsQuery = useQuery({
    queryKey: ['participants'],
    queryFn: () => participantsApi.list(),
  });
  const detailQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId!),
    enabled: Boolean(taskId),
  });
  const departments = useMemo(
    () => flattenDepartments(treeQuery.data?.departments ?? []),
    [treeQuery.data],
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [skills, setSkills] = useState('');
  const [target, setTarget] = useState<TaskTarget | null>(null);
  const [picker, setPicker] = useState<'department' | 'target' | null>(null);
  const [targetType, setTargetType] = useState<
    'position' | 'participant' | 'department'
  >('position');
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    const task = detailQuery.data?.task;
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setDepartmentId(task.departmentId);
    setSkills(task.requiredSkillTags.join(', '));
    setTarget(task.target);
    if (task.target) setTargetType(task.target.type);
  }, [detailQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (taskId) {
        return tasksApi.update(taskId, {
          title: title.trim(),
          description,
          target,
          requiredSkillTags: skills
            .split(',')
            .map(item => item.trim())
            .filter(Boolean),
        });
      }
      return tasksApi.create({
        title: title.trim(),
        description,
        departmentId: departmentId!,
        ...(target ? { target } : {}),
        requiredSkillTags: skills
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
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
  const queryError =
    treeQuery.error ??
    positionsQuery.error ??
    participantsQuery.error ??
    detailQuery.error;
  const error = useRecoverableApiError(mutation.error ?? queryError);
  useEffect(() => {
    if (mutation.error && error && isConflictProblem(error)) {
      void detailQuery.refetch();
    }
  }, [mutation.error, error, detailQuery.refetch]);
  const creatableDepartments = departments.filter(department =>
    can('task.create', { departmentId: department.id, self: true }),
  );
  const canCreate = taskId
    ? detailQuery.data?.task.creatorId === participantId ||
      Boolean(
        detailQuery.data?.task &&
          can('task.manage', {
            departmentId: detailQuery.data.task.departmentId,
          }),
      )
    : creatableDepartments.length > 0;
  const loading =
    treeQuery.isLoading ||
    positionsQuery.isLoading ||
    participantsQuery.isLoading ||
    detailQuery.isLoading;
  const availablePositions = (positionsQuery.data?.positions ?? []).filter(
    position =>
      departmentId &&
      departmentIsWithin(departments, departmentId, position.departmentId),
  );
  const targetLabel =
    target?.type === 'position'
      ? positionsQuery.data?.positions.find(
          item => item.id === target.positionId,
        )?.name
      : target?.type === 'participant'
      ? participantsQuery.data?.participants.find(
          item => item.id === target.participantId,
        )?.name
      : target?.type === 'department'
      ? departments.find(item => item.id === target.departmentId)?.name
      : 'No target';

  const submit = () => {
    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }
    if (!taskId && !departmentId) {
      mutation.reset();
      setTitleError('Choose a department');
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
      {!loading && !canCreate ? (
        <InlineNotice message="You are not authorized to create or edit this task." />
      ) : null}
      {!loading && canCreate ? (
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
              <SectionTitle>Department</SectionTitle>
              <TouchableOpacity
                testID="task-form-department"
                onPress={() =>
                  setPicker(picker === 'department' ? null : 'department')
                }
              >
                <Card>
                  <Text style={workflowStyles.body}>
                    {departments.find(item => item.id === departmentId)?.name ??
                      'Choose department'}
                  </Text>
                </Card>
              </TouchableOpacity>
              {picker === 'department'
                ? creatableDepartments.map(department => (
                    <TouchableOpacity
                      key={department.id}
                      testID={`department-picker-${department.id}`}
                      onPress={() => {
                        setDepartmentId(department.id);
                        setTarget(null);
                        setPicker(null);
                      }}
                    >
                      <Card>
                        <Text style={workflowStyles.body}>
                          {department.name}
                        </Text>
                      </Card>
                    </TouchableOpacity>
                  ))
                : null}
            </>
          ) : null}
          <SectionTitle>Target</SectionTitle>
          <TouchableOpacity
            testID="task-form-target"
            onPress={() => setPicker(picker === 'target' ? null : 'target')}
          >
            <Card>
              <Text style={workflowStyles.body}>{targetLabel}</Text>
            </Card>
          </TouchableOpacity>
          {picker === 'target' ? (
            <View>
              <View style={[workflowStyles.wrap, { padding: 14 }]}>
                <Chip
                  testID="task-target-type-position"
                  label="Position"
                  selected={targetType === 'position'}
                  onPress={() => setTargetType('position')}
                />
                <Chip
                  testID="task-target-type-participant"
                  label="Participant"
                  selected={targetType === 'participant'}
                  onPress={() => setTargetType('participant')}
                />
                <Chip
                  testID="task-target-type-department"
                  label="Department"
                  selected={targetType === 'department'}
                  onPress={() => setTargetType('department')}
                />
              </View>
              {targetType === 'position'
                ? availablePositions.map(position => (
                    <TouchableOpacity
                      key={position.id}
                      testID={`task-target-position-${position.id}`}
                      onPress={() => {
                        setTarget({
                          type: 'position',
                          positionId: position.id,
                        });
                        setPicker(null);
                      }}
                    >
                      <Card>
                        <Text style={workflowStyles.body}>{position.name}</Text>
                      </Card>
                    </TouchableOpacity>
                  ))
                : null}
              {targetType === 'participant'
                ? (participantsQuery.data?.participants ?? [])
                    .filter(item => item.kind !== 'gateway')
                    .map(participant => (
                      <TouchableOpacity
                        key={participant.id}
                        testID={`task-target-participant-${participant.id}`}
                        onPress={() => {
                          setTarget({
                            type: 'participant',
                            participantId: participant.id,
                          });
                          setPicker(null);
                        }}
                      >
                        <Card>
                          <Text style={workflowStyles.body}>
                            {participant.name}
                          </Text>
                        </Card>
                      </TouchableOpacity>
                    ))
                : null}
              {targetType === 'department'
                ? departments
                    .filter(
                      item =>
                        departmentId &&
                        departmentIsWithin(departments, departmentId, item.id),
                    )
                    .map(department => (
                      <TouchableOpacity
                        key={department.id}
                        testID={`task-target-department-${department.id}`}
                        onPress={() => {
                          setTarget({
                            type: 'department',
                            departmentId: department.id,
                            includeDescendants: true,
                          });
                          setPicker(null);
                        }}
                      >
                        <Card>
                          <Text style={workflowStyles.body}>
                            {department.name}
                          </Text>
                        </Card>
                      </TouchableOpacity>
                    ))
                : null}
            </View>
          ) : null}
          <Field
            label="Required skill tags (comma separated)"
            testID="task-form-skill-tags"
            value={skills}
            onChangeText={setSkills}
            autoCapitalize="none"
          />
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
