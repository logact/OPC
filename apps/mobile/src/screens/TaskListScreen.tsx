import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { ListTasksQuery, TaskStatus } from '@logact-pub/opc-protocol';
import { tasksApi } from '../api/http';
import {
  Card,
  Chip,
  EmptyState,
  InlineNotice,
  LoadingState,
  WorkflowHeader,
  WorkflowScreen,
  workflowStyles,
} from '../components/WorkflowUI';
import { useAuth } from '../hooks/useAuth';
import { useMqtt } from '../contexts/MqttContext';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { useCapabilityStore } from '../stores/capabilityStore';
import { theme } from '../theme';
import { filterTasksForScope, type TaskScope } from '../utils/taskScopes';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'created', label: 'Created' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'collaborating', label: 'Collaborating' },
  { id: 'review', label: 'Review' },
  { id: 'managed', label: 'Managed' },
];
const STATUSES: TaskStatus[] = [
  'draft',
  'assigned',
  'in_progress',
  'blocked',
  'review',
  'completed',
  'failed',
  'cancelled',
];

type Scope = TaskScope;

export function TaskListScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { participantId } = useAuth();
  const { state: mqttState } = useMqtt();
  const can = useCapabilityStore(state => state.can);
  const departments = useCapabilityStore(state => state.departments);
  const hydrateCapabilities = useCapabilityStore(state => state.hydrate);
  const [scope, setScope] = useState<Scope>('created');
  const [status, setStatus] = useState<TaskStatus | null>(null);

  const query = useMemo<Partial<ListTasksQuery>>(
    () => ({
      limit: 200,
      ...(status ? { status } : {}),
      ...(scope === 'created' && participantId
        ? { creatorId: participantId }
        : {}),
      ...(scope === 'assigned' && participantId
        ? { assigneeId: participantId }
        : {}),
      ...(scope === 'review' && participantId
        ? { reviewerId: participantId }
        : {}),
    }),
    [scope, status, participantId],
  );
  const taskQuery = useQuery({
    queryKey: ['tasks', scope, status, participantId],
    queryFn: () => tasksApi.list(query),
    enabled: Boolean(participantId),
  });
  const problem = useRecoverableApiError(taskQuery.error);
  useFocusEffect(
    useCallback(() => {
      if (participantId) void hydrateCapabilities(participantId, true);
      void taskQuery.refetch();
    }, [participantId, hydrateCapabilities, taskQuery.refetch]),
  );

  const tasks = filterTasksForScope(
    taskQuery.data?.tasks ?? [],
    scope,
    participantId,
    (capability, departmentId) => can(capability, { departmentId }),
  );
  const canCreate =
    can('task.create', { self: true }) ||
    departments.some(department =>
      can('task.create', { departmentId: department.id, self: true }),
    );

  return (
    <WorkflowScreen testID="screen-tasks" scroll={false}>
      <WorkflowHeader
        title="Tasks"
        action={
          canCreate ? (
            <TouchableOpacity
              testID="task-create"
              onPress={() => navigation.navigate('TaskForm', {})}
            >
              <Text style={workflowStyles.link}>＋</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      {mqttState !== 'connected' ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>
            Realtime offline · HTTP actions can be retried
          </Text>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scopeBar}
        contentContainerStyle={styles.scopeContent}
      >
        {SCOPES.map(item => (
          <Chip
            key={item.id}
            testID={`task-scope-${item.id}`}
            label={item.label}
            selected={scope === item.id}
            onPress={() => setScope(item.id)}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.scopeContent}
      >
        <Chip label="All" selected={!status} onPress={() => setStatus(null)} />
        {STATUSES.map(item => (
          <Chip
            key={item}
            testID={`task-status-filter-${item}`}
            label={item.replaceAll('_', ' ')}
            selected={status === item}
            onPress={() => setStatus(item)}
          />
        ))}
      </ScrollView>
      {taskQuery.isLoading ? <LoadingState label="Loading tasks…" /> : null}
      {problem ? (
        <InlineNotice
          message={problem.message}
          onRetry={() => void taskQuery.refetch()}
        />
      ) : null}
      {!taskQuery.isLoading && !problem ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
        >
          {tasks.length === 0 ? (
            <EmptyState
              label={`No ${SCOPES.find(
                item => item.id === scope,
              )?.label.toLowerCase()} tasks`}
            />
          ) : null}
          {tasks.map(task => (
            <Card
              key={task.id}
              testID={`task-item-${task.id}`}
              onPress={() =>
                navigation.navigate('TaskDetail', { taskId: task.id })
              }
            >
              <View style={styles.taskHeader}>
                <Text style={workflowStyles.title}>{task.title}</Text>
                <Text style={styles.status}>
                  {task.status.replaceAll('_', ' ')}
                </Text>
              </View>
              <Text style={workflowStyles.muted}>
                {task.description || 'No description'}
              </Text>
              <Text style={workflowStyles.muted}>
                {task.requiredSkillTags.join(' · ')}
              </Text>
            </Card>
          ))}
        </ScrollView>
      ) : null}
    </WorkflowScreen>
  );
}

const styles = StyleSheet.create({
  scopeBar: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
  },
  filterBar: { flexGrow: 0 },
  scopeContent: { padding: 10, gap: 7 },
  list: { flex: 1 },
  listContent: { paddingBottom: 30 },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  status: {
    color: theme.colors.accent,
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  offline: { padding: 7, backgroundColor: '#322711', alignItems: 'center' },
  offlineText: { color: theme.colors.warning, fontSize: 11 },
});
