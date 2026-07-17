import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from '../screens/LoginScreen';
import { RoomListScreen } from '../screens/RoomListScreen';
import { ChatScreen } from '../screens/ChatScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
            name="RoomList"
            component={RoomListScreen}
            options={{ title: '房间列表' }}
          />
          <Stack.Screen
            name="Chat"
            component={ChatScreen}
            options={({ route }) => ({ title: route.params.roomName })}
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
