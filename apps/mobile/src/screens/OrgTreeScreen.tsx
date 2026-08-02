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
import type { DepartmentNode } from '@logact-pub/opc-protocol';
import { organizationApi } from '../api/http';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { useAuth } from '../hooks/useAuth';
import { useCapabilityStore } from '../stores/capabilityStore';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { departmentIsWithin, flattenDepartments } from '../utils/organization';
import {
  ActionButton,
  EmptyState,
  InlineNotice,
  LoadingState,
  WorkflowHeader,
  WorkflowScreen,
  workflowStyles,
} from '../components/WorkflowUI';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

function DepartmentBranch({
  node,
  depth,
  expanded,
  staffCount,
  onToggle,
  onOpen,
}: {
  node: DepartmentNode;
  depth: number;
  expanded: Set<string>;
  staffCount: (id: string) => number;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const responsibility = node.positions
    .flatMap(position => position.responsibilities.map(item => item.title))
    .slice(0, 2)
    .join(' · ');
  return (
    <View>
      <View
        style={[styles.node, { marginLeft: 12 + depth * 16 }]}
        testID={`org-node-${node.id}`}
      >
        <TouchableOpacity
          testID={`org-node-toggle-${node.id}`}
          onPress={() => onToggle(node.id)}
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>
            {node.children.length ? (isExpanded ? '▾' : '▸') : '•'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.nodeBody}
          onPress={() => onOpen(node.id)}
        >
          <Text style={workflowStyles.title}>{node.name}</Text>
          <View style={workflowStyles.wrap}>
            <Text
              style={workflowStyles.muted}
              testID={`org-node-staff-count-${node.id}`}
            >
              {staffCount(node.id)} staff
            </Text>
            <Text
              style={workflowStyles.muted}
              testID={`org-node-leaders-${node.id}`}
            >
              {node.leaders.length} leaders
            </Text>
            <Text
              style={workflowStyles.muted}
              testID={`org-node-positions-${node.id}`}
            >
              {node.positions.length} positions
            </Text>
          </View>
          {responsibility ? (
            <Text style={workflowStyles.muted} numberOfLines={2}>
              {responsibility}
            </Text>
          ) : null}
        </TouchableOpacity>
      </View>
      {isExpanded
        ? node.children.map(child => (
            <DepartmentBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              staffCount={staffCount}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        : null}
    </View>
  );
}

export function OrgTreeScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { participantId } = useAuth();
  const can = useCapabilityStore(state => state.can);
  const hydrateCapabilities = useCapabilityStore(state => state.hydrate);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const treeQuery = useQuery({
    queryKey: ['organization', 'tree'],
    queryFn: organizationApi.tree,
  });
  const staffQuery = useQuery({
    queryKey: ['organization', 'staff'],
    queryFn: organizationApi.listStaff,
  });
  const error = treeQuery.error ?? staffQuery.error;
  const problem = useRecoverableApiError(error);

  useFocusEffect(
    useCallback(() => {
      if (participantId) void hydrateCapabilities(participantId, true);
      void treeQuery.refetch();
      void staffQuery.refetch();
    }, [
      participantId,
      hydrateCapabilities,
      treeQuery.refetch,
      staffQuery.refetch,
    ]),
  );

  const countByDepartment = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const departments = flattenDepartments(treeQuery.data?.departments ?? []);
    for (const department of departments) map.set(department.id, new Set());
    for (const profile of staffQuery.data?.staff ?? []) {
      for (const department of departments) {
        if (
          profile.assignments.some(
            assignment =>
              assignment.active &&
              departmentIsWithin(
                departments,
                department.id,
                assignment.departmentId,
              ),
          )
        ) {
          map.get(department.id)?.add(profile.participantId);
        }
      }
    }
    return map;
  }, [staffQuery.data, treeQuery.data]);

  const toggle = (id: string) =>
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <WorkflowScreen testID="screen-org" scroll={false}>
      <WorkflowHeader
        title={treeQuery.data?.organization.name ?? 'Organization'}
        action={
          can('department.manage') ? (
            <TouchableOpacity
              testID="org-create-department"
              onPress={() =>
                navigation.navigate('DepartmentForm', { mode: 'create' })
              }
            >
              <Text style={workflowStyles.link}>＋</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      {treeQuery.isLoading || staffQuery.isLoading ? <LoadingState /> : null}
      {problem ? (
        <InlineNotice
          message={problem.message}
          onRetry={() => {
            void treeQuery.refetch();
            void staffQuery.refetch();
          }}
        />
      ) : null}
      {!treeQuery.isLoading && !problem ? (
        <ScrollView style={styles.flex} testID="org-tree">
          {(treeQuery.data?.departments.length ?? 0) === 0 ? (
            <EmptyState label="No departments yet" />
          ) : null}
          {treeQuery.data?.departments.map(node => (
            <DepartmentBranch
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              staffCount={id => countByDepartment.get(id)?.size ?? 0}
              onToggle={toggle}
              onOpen={departmentId =>
                navigation.navigate('DepartmentDetail', { departmentId })
              }
            />
          ))}
          {can('department.manage') ? (
            <ActionButton
              title="Create root department"
              testID="org-create-department-secondary"
              variant="secondary"
              onPress={() =>
                navigation.navigate('DepartmentForm', { mode: 'create' })
              }
            />
          ) : null}
        </ScrollView>
      ) : null}
    </WorkflowScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  node: {
    flexDirection: 'row',
    marginRight: 12,
    marginTop: 9,
    padding: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
  },
  toggle: { width: 28, alignItems: 'center', paddingTop: 2 },
  toggleText: { color: theme.colors.accent, fontSize: 16 },
  nodeBody: { flex: 1, gap: 4 },
});
