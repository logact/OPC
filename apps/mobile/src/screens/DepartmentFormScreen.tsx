import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationApi } from '../api/http';
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
import { useCapabilityStore } from '../stores/capabilityStore';
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { departmentIsWithin, flattenDepartments } from '../utils/organization';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Params = {
  mode: 'create' | 'edit' | 'move';
  departmentId?: string;
  parentId?: string;
};

export function DepartmentFormScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const params = route.params as Params;
  const queryClient = useQueryClient();
  const can = useCapabilityStore(state => state.can);
  const treeQuery = useQuery({
    queryKey: ['organization', 'tree'],
    queryFn: organizationApi.tree,
  });
  const departments = useMemo(
    () => flattenDepartments(treeQuery.data?.departments ?? []),
    [treeQuery.data],
  );
  const current = departments.find(item => item.id === params.departmentId);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(
    params.parentId ?? null,
  );
  const [showParents, setShowParents] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (current) {
      setName(current.name);
      setParentId(current.parentId);
    }
  }, [current]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!name.trim() && params.mode !== 'move')
        throw new Error('Department name is required');
      if (params.mode === 'create')
        return organizationApi.createDepartment({
          name: name.trim(),
          parentId,
        });
      if (!params.departmentId) throw new Error('Department is missing');
      return organizationApi.updateDepartment(
        params.departmentId,
        params.mode === 'move' ? { parentId } : { name: name.trim() },
      );
    },
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      navigation.replace('DepartmentDetail', {
        departmentId: result.department.id,
      });
    },
  });

  const targetId =
    params.mode === 'create' ? params.parentId : params.departmentId;
  const authorized = can(
    'department.manage',
    targetId ? { departmentId: targetId } : undefined,
  );
  const selectableParents = departments.filter(
    department =>
      department.id !== params.departmentId &&
      (!params.departmentId ||
        !departmentIsWithin(departments, params.departmentId, department.id)) &&
      can('department.manage', { departmentId: department.id }),
  );
  const error = useRecoverableApiError(mutation.error ?? treeQuery.error);

  const submit = () => {
    if (!name.trim() && params.mode !== 'move') {
      setFieldError('Department name is required');
      return;
    }
    setFieldError(null);
    mutation.mutate();
  };

  return (
    <WorkflowScreen testID="screen-department-form">
      <WorkflowHeader
        title={
          params.mode === 'create'
            ? 'Create department'
            : params.mode === 'move'
            ? 'Move department'
            : 'Edit department'
        }
        onBack={() => navigation.goBack()}
      />
      {treeQuery.isLoading ? <LoadingState /> : null}
      {error && !mutation.error ? (
        <InlineNotice
          message={error.message}
          onRetry={() => void treeQuery.refetch()}
        />
      ) : null}
      {!treeQuery.isLoading && !authorized ? (
        <InlineNotice message="You are not authorized to manage this department." />
      ) : null}
      {authorized ? (
        <>
          {params.mode !== 'move' ? (
            <Field
              label="Name"
              testID="department-form-name"
              value={name}
              onChangeText={setName}
              error={fieldError}
              autoCapitalize="words"
            />
          ) : (
            <Card>
              <Text style={workflowStyles.title}>{current?.name}</Text>
            </Card>
          )}
          {params.mode !== 'edit' ? (
            <>
              <SectionTitle>Parent department</SectionTitle>
              <TouchableOpacity
                testID="department-form-parent"
                onPress={() => setShowParents(value => !value)}
              >
                <Card>
                  <Text style={workflowStyles.body}>
                    {departments.find(item => item.id === parentId)?.name ??
                      'Root level'}
                  </Text>
                </Card>
              </TouchableOpacity>
              {showParents ? (
                <View>
                  {can('department.manage') ? (
                    <TouchableOpacity
                      testID="department-picker-root"
                      onPress={() => {
                        setParentId(null);
                        setShowParents(false);
                      }}
                    >
                      <Card>
                        <Text style={workflowStyles.body}>Root level</Text>
                      </Card>
                    </TouchableOpacity>
                  ) : null}
                  {selectableParents.map(department => (
                    <TouchableOpacity
                      key={department.id}
                      testID={`department-picker-${department.id}`}
                      onPress={() => {
                        setParentId(department.id);
                        setShowParents(false);
                      }}
                    >
                      <Card>
                        <Text style={workflowStyles.body}>
                          {department.name}
                        </Text>
                      </Card>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
          <ActionButton
            title={mutation.isPending ? 'Saving…' : 'Save'}
            testID="department-form-submit"
            disabled={mutation.isPending}
            onPress={submit}
          />
        </>
      ) : null}
      <Toast
        message={mutation.error ? error?.message ?? 'Save failed' : null}
      />
    </WorkflowScreen>
  );
}
