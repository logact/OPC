import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CapabilityGrant,
  CapabilityName,
  CapabilityScope,
  Responsibility,
} from '@logact-pub/opc-protocol';
import { organizationApi } from '../api/http';
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
import { useRecoverableApiError } from '../hooks/useRecoverableApiError';
import { flattenDepartments } from '../utils/organization';
import type { RootStackParamList } from '../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
const CAPABILITIES: CapabilityName[] = [
  'organization.read',
  'organization.manage',
  'department.read',
  'department.manage',
  'position.read',
  'position.manage',
  'staff.read',
  'staff.manage',
  'participant.read',
  'participant.manage',
  'agent.manage',
  'room.create',
  'room.read',
  'room.manage',
  'room.members.manage',
  'message.read',
  'message.send',
  'capability.delegate',
  'authorization.audit.read',
];
const SCOPES: CapabilityScope['type'][] = [
  'self',
  'department',
  'department_subtree',
  'organization',
];

export function PositionFormScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { departmentId, positionId } = route.params as {
    departmentId: string;
    positionId?: string;
  };
  const can = useCapabilityStore(state => state.can);
  const queryClient = useQueryClient();
  const positionQuery = useQuery({
    queryKey: ['organization', 'position', positionId],
    queryFn: () => organizationApi.getPosition(positionId!),
    enabled: Boolean(positionId),
  });
  const treeQuery = useQuery({
    queryKey: ['organization', 'tree'],
    queryFn: organizationApi.tree,
  });
  const departments = flattenDepartments(treeQuery.data?.departments ?? []);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [responsibilityTitle, setResponsibilityTitle] = useState('');
  const [responsibilityDescription, setResponsibilityDescription] =
    useState('');
  const [otherResponsibilities, setOtherResponsibilities] = useState<
    Responsibility[]
  >([]);
  const [skills, setSkills] = useState('');
  const [grantCapability, setGrantCapability] = useState<CapabilityName | null>(
    null,
  );
  const [grantScope, setGrantScope] =
    useState<CapabilityScope['type']>('department');
  const [grants, setGrants] = useState<CapabilityGrant[]>([]);
  const [targetDepartmentId, setTargetDepartmentId] = useState(departmentId);
  const [showDepartments, setShowDepartments] = useState(false);
  const [showGrants, setShowGrants] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    const position = positionQuery.data?.position;
    if (!position) return;
    setName(position.name);
    setDescription(position.description ?? '');
    setResponsibilityTitle(position.responsibilities[0]?.title ?? '');
    setResponsibilityDescription(
      position.responsibilities[0]?.description ?? '',
    );
    setOtherResponsibilities(position.responsibilities.slice(1));
    setSkills(position.skillTags.join(', '));
    setGrants(position.capabilityGrants);
    setTargetDepartmentId(position.departmentId);
  }, [positionQuery.data]);

  const mergedGrants = (): CapabilityGrant[] => {
    if (!grantCapability) return grants;
    return [
      ...grants.filter(grant => grant.capability !== grantCapability),
      {
        capability: grantCapability,
        scope: { type: grantScope } as CapabilityScope,
      },
    ];
  };

  const canDelegate = can('capability.delegate', {
    departmentId: targetDepartmentId,
  });
  const payload = () => ({
    name: name.trim(),
    description: description.trim() || undefined,
    responsibilities: responsibilityTitle.trim()
      ? [
          {
            id:
              positionQuery.data?.position.responsibilities[0]?.id ??
              `responsibility-${Date.now()}`,
            title: responsibilityTitle.trim(),
            description: responsibilityDescription.trim(),
          },
          ...otherResponsibilities,
        ]
      : otherResponsibilities,
    skillTags: skills
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
    ...(canDelegate ? { capabilityGrants: mergedGrants() } : {}),
  });
  const mutation = useMutation({
    mutationFn: () =>
      positionId
        ? organizationApi.updatePosition(positionId, {
            ...payload(),
            departmentId: targetDepartmentId,
          })
        : organizationApi.createPosition({
            departmentId: targetDepartmentId,
            ...payload(),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      navigation.replace('DepartmentDetail', {
        departmentId: targetDepartmentId,
      });
    },
  });
  const sourceDepartmentId =
    positionQuery.data?.position.departmentId ?? departmentId;
  const authorized = can('position.manage', {
    departmentId: sourceDepartmentId,
  });
  const manageableDepartments = departments.filter(department =>
    can('position.manage', { departmentId: department.id }),
  );
  const queryError = positionQuery.error ?? treeQuery.error;
  const error = useRecoverableApiError(mutation.error ?? queryError);
  const loading = positionQuery.isLoading || treeQuery.isLoading;

  return (
    <WorkflowScreen testID="screen-position-form">
      <WorkflowHeader
        title={positionId ? 'Edit position' : 'Create position'}
        onBack={() => navigation.goBack()}
      />
      {loading ? <LoadingState /> : null}
      {error && !mutation.error ? (
        <InlineNotice
          message={error.message}
          onRetry={() => {
            void positionQuery.refetch();
            void treeQuery.refetch();
          }}
        />
      ) : null}
      {!authorized ? (
        <InlineNotice message="You are not authorized to manage positions here." />
      ) : null}
      {authorized ? (
        <>
          <Field
            label="Name"
            testID="position-form-name"
            value={name}
            onChangeText={setName}
            error={fieldError}
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          {otherResponsibilities.map(responsibility => (
            <Card key={responsibility.id}>
              <Text style={workflowStyles.title}>{responsibility.title}</Text>
              <Text style={workflowStyles.muted}>
                {responsibility.description}
              </Text>
              <ActionButton
                title="Remove responsibility"
                variant="secondary"
                onPress={() =>
                  setOtherResponsibilities(current =>
                    current.filter(item => item.id !== responsibility.id),
                  )
                }
              />
            </Card>
          ))}
          <Field
            label="Responsibility"
            testID="position-form-responsibility-title"
            value={responsibilityTitle}
            onChangeText={setResponsibilityTitle}
          />
          <Field
            label="Responsibility summary"
            testID="position-form-responsibility-description"
            value={responsibilityDescription}
            onChangeText={setResponsibilityDescription}
            multiline
          />
          <Field
            label="Skill tags (comma separated)"
            testID="position-form-skill-tags"
            value={skills}
            onChangeText={setSkills}
            autoCapitalize="none"
          />
          <SectionTitle>Department</SectionTitle>
          <TouchableOpacity
            testID="position-form-department"
            onPress={() => setShowDepartments(value => !value)}
          >
            <Card>
              <Text style={workflowStyles.body}>
                {departments.find(item => item.id === targetDepartmentId)
                  ?.name ?? targetDepartmentId}
              </Text>
            </Card>
          </TouchableOpacity>
          {showDepartments
            ? manageableDepartments.map(department => (
                <TouchableOpacity
                  key={department.id}
                  testID={`department-picker-${department.id}`}
                  onPress={() => {
                    setTargetDepartmentId(department.id);
                    setShowDepartments(false);
                  }}
                >
                  <Card>
                    <Text style={workflowStyles.body}>{department.name}</Text>
                  </Card>
                </TouchableOpacity>
              ))
            : null}
          <SectionTitle>Capability grant</SectionTitle>
          {canDelegate ? (
            <TouchableOpacity
              testID="position-grant-add"
              onPress={() => setShowGrants(value => !value)}
            >
              <Card>
                <Text style={workflowStyles.body}>＋ Add capability grant</Text>
              </Card>
            </TouchableOpacity>
          ) : (
            <InlineNotice
              tone="info"
              message="Capability grants are read-only without delegation authority."
            />
          )}
          {canDelegate && showGrants ? (
            <View style={workflowStyles.wrap}>
              {CAPABILITIES.map(capability => (
                <Chip
                  key={capability}
                  testID={`capability-option-${capability.replaceAll(
                    '.',
                    '-',
                  )}`}
                  label={capability}
                  selected={grantCapability === capability}
                  onPress={() => {
                    if (grantCapability) {
                      setGrants(current => [
                        ...current.filter(
                          grant => grant.capability !== grantCapability,
                        ),
                        {
                          capability: grantCapability,
                          scope: { type: grantScope } as CapabilityScope,
                        },
                      ]);
                    }
                    const existing = grants.find(
                      grant => grant.capability === capability,
                    );
                    setGrantCapability(capability);
                    setGrantScope(existing?.scope.type ?? 'department');
                  }}
                />
              ))}
            </View>
          ) : null}
          {canDelegate && grantCapability ? (
            <View style={workflowStyles.wrap}>
              {SCOPES.map(scope => (
                <Chip
                  key={scope}
                  testID={`capability-scope-${scope.replaceAll('_', '-')}`}
                  label={scope}
                  selected={grantScope === scope}
                  onPress={() => setGrantScope(scope)}
                />
              ))}
            </View>
          ) : null}
          {mergedGrants().map(grant => (
            <Card key={grant.capability}>
              <Text style={workflowStyles.title}>{grant.capability}</Text>
              <Text style={workflowStyles.muted}>{grant.scope.type}</Text>
              {canDelegate ? (
                <ActionButton
                  title="Remove grant"
                  testID={`position-grant-remove-${grant.capability.replaceAll(
                    '.',
                    '-',
                  )}`}
                  variant="secondary"
                  onPress={() => {
                    setGrants(current =>
                      current.filter(
                        item => item.capability !== grant.capability,
                      ),
                    );
                    if (grantCapability === grant.capability) {
                      setGrantCapability(null);
                    }
                  }}
                />
              ) : null}
            </Card>
          ))}
          <ActionButton
            title={mutation.isPending ? 'Saving…' : 'Save position'}
            testID="position-form-submit"
            disabled={mutation.isPending}
            onPress={() => {
              if (!name.trim()) {
                setFieldError('Position name is required');
                return;
              }
              setFieldError(null);
              mutation.mutate();
            }}
          />
        </>
      ) : null}
      <Toast
        message={mutation.error ? error?.message ?? 'Save failed' : null}
      />
    </WorkflowScreen>
  );
}
