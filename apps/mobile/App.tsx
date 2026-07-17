/**
 * OPC Mobile root component.
 *
 * @format
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar, useColorScheme } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { MqttProvider } from './src/contexts/MqttContext';

const queryClient = new QueryClient();

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <MqttProvider>
          <NavigationContainer>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
            <AppNavigator />
          </NavigationContainer>
        </MqttProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default App;
