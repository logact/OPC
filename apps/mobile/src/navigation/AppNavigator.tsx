import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../hooks/useAuth';
import { theme } from '../theme';
import { LoginScreen } from '../screens/LoginScreen';
import { RoomListScreen } from '../screens/RoomListScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { AddAgentScreen } from '../screens/AddAgentScreen';
import { MeScreen } from '../screens/MeScreen';
import { RoomInfoScreen } from '../screens/RoomInfoScreen';
import { NewGroupScreen } from '../screens/NewGroupScreen';
import { ServerConfigScreen } from '../screens/ServerConfigScreen';
import { OrgTreeScreen } from '../screens/OrgTreeScreen';
import { DepartmentDetailScreen } from '../screens/DepartmentDetailScreen';
import { DepartmentFormScreen } from '../screens/DepartmentFormScreen';
import { PositionFormScreen } from '../screens/PositionFormScreen';
import { StaffAssignmentsScreen } from '../screens/StaffAssignmentsScreen';
import { TaskListScreen } from '../screens/TaskListScreen';
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { TaskFormScreen } from '../screens/TaskFormScreen';
import { TaskAssignmentScreen } from '../screens/TaskAssignmentScreen';
import { useCapabilityStore } from '../stores/capabilityStore';
import type { MainTabsParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabsParamList>();

function TabIcon({ icon }: { icon: string }): React.JSX.Element {
  return <Text style={styles.tabIcon}>{icon}</Text>;
}

function MainTabs(): React.JSX.Element {
  const { participantId } = useAuth();
  const hydrateCapabilities = useCapabilityStore(state => state.hydrate);
  const resetCapabilities = useCapabilityStore(state => state.reset);

  useEffect(() => {
    if (participantId) void hydrateCapabilities(participantId);
    else resetCapabilities();
  }, [participantId, hydrateCapabilities, resetCapabilities]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: {
          height: 64,
          backgroundColor: theme.colors.panel,
          borderTopColor: theme.colors.line,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      }}
    >
      <Tab.Screen
        name="Chats"
        component={RoomListScreen}
        options={{
          title: 'Chats',
          tabBarButtonTestID: 'tab-chats',
          tabBarIcon: () => <TabIcon icon="💬" />,
        }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          title: 'Contacts',
          tabBarButtonTestID: 'tab-contacts',
          tabBarIcon: () => <TabIcon icon="🤖" />,
        }}
      />
      <Tab.Screen
        name="AddAgent"
        component={AddAgentScreen}
        options={{
          title: 'Add Agent',
          tabBarButtonTestID: 'tab-addagent',
          tabBarIcon: () => <TabIcon icon="⊕" />,
        }}
      />
      <Tab.Screen
        name="Org"
        component={OrgTreeScreen}
        options={{
          title: 'Org',
          tabBarButtonTestID: 'tab-org',
          tabBarIcon: () => <TabIcon icon="◫" />,
        }}
      />
      <Tab.Screen
        name="Tasks"
        component={TaskListScreen}
        options={{
          title: 'Tasks',
          tabBarButtonTestID: 'tab-tasks',
          tabBarIcon: () => <TabIcon icon="✓" />,
        }}
      />
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{
          title: 'Me',
          tabBarButtonTestID: 'tab-me',
          tabBarIcon: () => <TabIcon icon="👤" />,
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator(): React.JSX.Element {
  const { isLoggedIn, isHydrated } = useAuth();

  if (!isHydrated) {
    // TODO: replace with a splash/loading screen
    return <></>;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: true }}>
      {isLoggedIn ? (
        <>
          <Stack.Screen
            name="MainTabs"
            component={MainTabs}
            options={{ headerShown: false, title: 'Chats' }}
          />
          <Stack.Screen
            name="Room"
            component={ChatScreen}
            options={({ route }) => ({
              title: route.params.roomName,
              // The room screen renders its own navbar; hide the native header
              // declaratively so it never flashes during the transition.
              headerShown: false,
            })}
          />
          <Stack.Screen
            name="RoomInfo"
            component={RoomInfoScreen}
            // The room info screen renders its own navbar, like Room.
            options={{ title: 'Room Info', headerShown: false }}
          />
          <Stack.Screen
            name="NewGroup"
            component={NewGroupScreen}
            // The new group screen renders its own navbar, like Room.
            options={{ title: 'New Group', headerShown: false }}
          />
          <Stack.Screen
            name="ServerConfig"
            component={ServerConfigScreen}
            options={{ title: 'Server Config', headerShown: false }}
          />
          <Stack.Screen
            name="DepartmentDetail"
            component={DepartmentDetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="DepartmentForm"
            component={DepartmentFormScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PositionForm"
            component={PositionFormScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="StaffAssignments"
            component={StaffAssignmentsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TaskDetail"
            component={TaskDetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TaskForm"
            component={TaskFormScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TaskAssignment"
            component={TaskAssignmentScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: 21,
  },
});
