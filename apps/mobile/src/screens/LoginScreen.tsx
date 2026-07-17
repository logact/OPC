import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';

export function LoginScreen(): React.JSX.Element {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const { register, isLoading, error, clearError } = useAuth();

  const handleRegister = async () => {
    clearError();
    if (!id.trim()) {
      Alert.alert('请输入参与者 ID');
      return;
    }
    await register(id.trim(), name.trim() || undefined);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>OPC Mobile</Text>
      <Text style={styles.subtitle}>通过 OPC-server 注册并连接</Text>

      <TextInput
        style={styles.input}
        placeholder="参与者 ID（必填）"
        value={id}
        onChangeText={setId}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        placeholder="显示名称（可选）"
        value={name}
        onChangeText={setName}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <Button title="注册并进入" onPress={handleRegister} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  error: {
    color: '#d32f2f',
    marginBottom: 16,
    textAlign: 'center',
  },
  loader: {
    marginVertical: 16,
  },
});
