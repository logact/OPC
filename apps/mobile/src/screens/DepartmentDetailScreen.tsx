import React, { useCallback, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { organizationApi, participantsApi } from '../api/http';
import {
  Card,
  EmptyState,
  InlineNotice,
  LoadingState,
  SectionTitle,
  WorkflowHeader,
  WorkflowScreen,
  workflowStyles,
} from '../components/WorkflowUI';
import { useCapabilityStore } from '../stores/capabilityStore';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { useParticipantPresence } from '../hooks/useParticipantPresence';
import { departmentIsWithin, flattenDepartments } from '../utils/organization';
import { presenceDisplay } from '../utils/presenceDisplay';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function DepartmentDetailScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { departmentId } = route.params as { departmentId: string };
  const can = useCapabilityStore(state => state.can);
  const livePresence = useParticipantPresence();
  const treeQuery = useQuery({
    queryKey: ['organization', 'tree'],
    queryFn: organizationApi.tree,
  });
  const staffQuery = useQuery({
    queryKey: ['organization', 'staff'],
    queryFn: organizationApi.listStaff,
  });
  const participantQuery = useQuery({
    queryKey: ['participants'],
    queryFn: () => participantsApi.list(),
  });
  const error = treeQuery.error ?? staffQuery.error ?? participantQuery.error;
  const problem = useRecoverableApiError(error);

  useFocusEffect(
    useCallback(() => {
      void treeQuery.refetch();
      void staffQuery.refetch();
      void participantQuery.refetch();
    }, [treeQuery.refetch, staffQuery.refetch, participantQuery.refetch]),
  );

  const departments = useMemo(
    () => flattenDepartments(treeQuery.data?.departments ?? []),
    [treeQuery.data],
  );
  const department = departments.find(item => item.id === departmentId);
  const participantById = new Map(
    (participantQuery.data?.participants ?? []).map(item => [item.id, item]),
  );
  const staff = (staffQuery.data?.staff ?? []).filter(profile =>
    profile.assignments.some(
      assignment =>
        assignment.active &&
        departmentIsWithin(departments, departmentId, assignment.departmentId),
    ),
  );
  const positionById = new Map(
    departments.flatMap(item => item.positions).map(item => [item.id, item]),
  );
  const loading =
    treeQuery.isLoading || staffQuery.isLoading || participantQuery.isLoading;

  return (
    <WorkflowScreen testID="screen-department-detail" scroll={false}>
      <WorkflowHeader
        title={department?.name ?? 'Department'}
        onBack={() => navigation.goBack()}
      />
      {loading ? <LoadingState /> : null}
      {problem ? (
        <InlineNotice
          message={problem.message}
          onRetry={() => {
            void treeQuery.refetch();
            void staffQuery.refetch();
            void participantQuery.refetch();
          }}
        />
      ) : null}
      {!loading && !problem && department ? (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <Card>
            <Text style={workflowStyles.title}>{department.name}</Text>
            <Text style={workflowStyles.muted}>
              Parent ·{' '}
              {departments.find(item => item.id === department.parentId)
                ?.name ?? 'Root level'}
            </Text>
            <Text style={workflowStyles.muted}>
              {staff.length} staff · {department.leaders.length} leaders ·{' '}
              {department.positions.length} positions
            </Text>
          </Card>

          {can('department.manage', { departmentId }) ? (
            <View style={styles.actions}>
              <TouchableOpacity
                testID="department-create"
                onPress={() =>
                  navigation.navigate('DepartmentForm', {
                    mode: 'create',
                    parentId: departmentId,
                  })
                }
              >
                <Text style={workflowStyles.link}>Create child</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="department-edit"
                onPress={() =>
                  navigation.navigate('DepartmentForm', {
                    mode: 'edit',
                    departmentId,
                  })
                }
              >
                <Text style={workflowStyles.link}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="department-move"
                onPress={() =>
                  navigation.navigate('DepartmentForm', {
                    mode: 'move',
                    departmentId,
                  })
                }
              >
                <Text style={workflowStyles.link}>Move</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <SectionTitle>Positions & responsibilities</SectionTitle>
          {department.positions.length === 0 ? (
            <EmptyState label="No positions" />
          ) : null}
          {department.positions.map(position => (
            <Card
              key={position.id}
              testID={`position-item-${position.id}`}
              onPress={
                can('position.manage', { departmentId })
                  ? () =>
                      navigation.navigate('PositionForm', {
                        departmentId,
                        positionId: position.id,
                      })
                  : undefined
              }
            >
              <Text style={workflowStyles.title}>{position.name}</Text>
              {position.description ? (
                <Text style={workflowStyles.body}>{position.description}</Text>
              ) : null}
              {position.responsibilities.map(responsibility => (
                <Text key={responsibility.id} style={workflowStyles.muted}>
                  {responsibility.title} — {responsibility.description}
                </Text>
              ))}
              <View style={workflowStyles.wrap}>
                {position.skillTags.map(tag => (
                  <Text key={tag} style={styles.pill}>
                    {tag}
                  </Text>
                ))}
              </View>
              {position.capabilityGrants.map((grant, index) => (
                <Text
                  key={`${grant.capability}-${index}`}
                  style={workflowStyles.muted}
                >
                  {grant.capability} · {grant.scope.type}
                </Text>
              ))}
            </Card>
          ))}
          {can('position.manage', { departmentId }) ? (
            <TouchableOpacity
              testID="position-create"
              style={styles.fullAction}
              onPress={() =>
                navigation.navigate('PositionForm', { departmentId })
              }
            >
              <Text style={workflowStyles.link}>＋ Create position</Text>
            </TouchableOpacity>
          ) : null}

          <SectionTitle>Staff roster</SectionTitle>
          {staff.length === 0 ? (
            <EmptyState label="No staff in this department" />
          ) : null}
          {staff.map(profile => {
            const participant = participantById.get(profile.participantId);
            if (!participant || participant.kind === 'gateway') return null;
            const assignments = profile.assignments.filter(
              assignment => assignment.active,
            );
            const isLeader = assignments.some(
              assignment =>
                assignment.departmentId === departmentId &&
                assignment.isDepartmentLeader,
            );
            const presence =
              livePresence[participant.id] ?? participant.presence;
            return (
              <Card
                key={participant.id}
                testID={`department-staff-${participant.id}`}
              >
                <View style={styles.staffTop}>
                  <View style={styles.staffInfo}>
                    <Text style={workflowStyles.title}>{participant.name}</Text>
                    <Text
                      style={workflowStyles.muted}
                      testID={`department-staff-kind-${participant.id}`}
                    >
                      {participant.kind.toUpperCase()}
                    </Text>
                  </View>
                  {participant.kind === 'agent' ? (
                    <Text
                      testID={`department-staff-presence-${participant.id}`}
                      style={[
                        styles.presence,
                        { color: presenceDisplay(presence).color },
                      ]}
                    >
                      {presenceDisplay(presence).label}
                    </Text>
                  ) : null}
                </View>
                {isLeader ? (
                  <Text
                    style={styles.leader}
                    testID={`department-staff-leader-${participant.id}`}
                  >
                    Department leader
                  </Text>
                ) : null}
                <Text style={workflowStyles.muted}>
                  {assignments
                    .map(
                      assignment =>
                        positionById.get(assignment.positionId)?.name,
                    )
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Card>
            );
          })}
          {can('staff.manage', { departmentId }) ? (
            <TouchableOpacity
              testID="department-staff-manage"
              style={styles.fullAction}
              onPress={() =>
                navigation.navigate('StaffAssignments', { departmentId })
              }
            >
              <Text style={workflowStyles.link}>Manage staff assignments</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : null}
    </WorkflowScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 30 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
  },
  fullAction: {
    margin: 14,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
  },
  pill: {
    color: theme.colors.agent,
    backgroundColor: '#251d3c',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
  },
  staffTop: { flexDirection: 'row', alignItems: 'center' },
  staffInfo: { flex: 1 },
  presence: { fontWeight: '700', fontSize: 12, textTransform: 'uppercase' },
  leader: {
    color: theme.colors.warning,
    fontSize: 12,
    fontWeight: '700',
    marginVertical: 4,
  },
});
