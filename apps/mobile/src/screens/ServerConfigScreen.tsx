import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useServerConfigStore } from '../stores/serverConfigStore';
import { theme } from '../theme';

export function ServerConfigScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { serverBaseUrl, mqttBrokerUrl, save } = useServerConfigStore();

  const [opcUrl, setOpcUrl] = useState(serverBaseUrl);
  const [mqttUrl, setMqttUrl] = useState(mqttBrokerUrl);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOpcUrl(serverBaseUrl);
    setMqttUrl(mqttBrokerUrl);
  }, [serverBaseUrl, mqttBrokerUrl]);

  const handleSave = async () => {
    const opc = opcUrl.trim();
    const mqtt = mqttUrl.trim();

    if (!opc) {
      Alert.alert('Error', 'OPC Server URL cannot be empty');
      return;
    }
    if (!mqtt) {
      Alert.alert('Error', 'MQTT Broker URL cannot be empty');
      return;
    }

    setSaving(true);
    try {
      await save({ serverBaseUrl: opc, mqttBrokerUrl: mqtt });
      Alert.alert('Saved', 'Server configuration updated. MQTT will reconnect automatically.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-server-config">
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="server-config-back">
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Server Config</Text>
        <View style={styles.navSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <Text style={styles.label}>OPC Server URL</Text>
          <TextInput
            style={styles.input}
            value={opcUrl}
            onChangeText={setOpcUrl}
            placeholder="http://localhost:3000"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="input-opc-url"
          />
          <Text style={styles.hint}>
            HTTP API endpoint for room, participant, and message operations.
          </Text>

          <Text style={[styles.label, styles.labelSpacing]}>MQTT Broker URL</Text>
          <TextInput
            style={styles.input}
            value={mqttUrl}
            onChangeText={setMqttUrl}
            placeholder="ws://localhost:9001"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="input-mqtt-url"
          />
          <Text style={styles.hint}>
            WebSocket endpoint for real-time messaging (ws:// or wss://).
          </Text>

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            testID="btn-save-config">
            <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  flex: {
    flex: 1,
  },
  navbar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
  },
  backBtn: {
    color: theme.colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  navTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  navSpacer: {
    width: 50,
  },
  content: {
    padding: 16,
  },
  label: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  labelSpacing: {
    marginTop: 24,
  },
  input: {
    backgroundColor: theme.colors.panel,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  hint: {
    color: theme.colors.muted,
    fontSize: 12,
    marginTop: 6,
  },
  saveBtn: {
    marginTop: 32,
    backgroundColor: theme.colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
