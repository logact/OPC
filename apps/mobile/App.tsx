/**
 * OPC Mobile root component.
 *
 * @format
 */

import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar, StyleSheet, View } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { MqttProvider } from './src/contexts/MqttContext';
import { useServerConfigStore } from './src/stores/serverConfigStore';
import { updateBaseUrl } from './src/api/http';
import { theme } from './src/theme';

const queryClient = new QueryClient();

function ServerConfigHydrator(): React.JSX.Element {
  const hydrate = useServerConfigStore((s) => s.hydrate);
  const serverBaseUrl = useServerConfigStore((s) => s.serverBaseUrl);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    updateBaseUrl(serverBaseUrl);
  }, [serverBaseUrl]);

  return <></>;
}

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <MqttProvider>
          <ServerConfigHydrator />
          <View style={styles.root}>
            <NavigationContainer>
              <StatusBar barStyle="light-content" />
              <AppNavigator />
            </NavigationContainer>
          </View>
        </MqttProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
});

export default App;
