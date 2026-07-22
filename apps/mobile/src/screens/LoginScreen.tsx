import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { theme } from '../theme';

export function LoginScreen(): React.JSX.Element {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const { register, isLoading, error, clearError } = useAuth();

  const handleRegister = async () => {
    clearError();
    if (!id.trim()) {
      // 行内错误而非原生 Alert：iOS 26.5 simulator 上 XCUITest 看不到
      // Alert 窗口，e2e 无法关闭它；本屏幕的错误本来就行内展示。
      setValidationError('请输入参与者 ID');
      return;
    }
    setValidationError(null);
    await register(id.trim(), name.trim() || undefined);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>OPC Mobile</Text>
        <Text style={styles.subtitle}>通过 OPC-server 注册并连接</Text>

        <View style={styles.field}>
          <Text style={styles.label}>参与者 ID</Text>
          <TextInput
            testID="login-id-input"
            style={styles.input}
            placeholder="参与者 ID（必填）"
            placeholderTextColor={theme.colors.muted}
            value={id}
            onChangeText={setId}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>显示名称</Text>
          <TextInput
            testID="login-name-input"
            style={styles.input}
            placeholder="显示名称（可选）"
            placeholderTextColor={theme.colors.muted}
            value={name}
            onChangeText={setName}
          />
        </View>

        {(validationError ?? error) ? (
          <Text testID="login-error" style={styles.error}>
            {validationError ?? error}
          </Text>
        ) : null}

        {isLoading ? (
          <ActivityIndicator style={styles.loader} color={theme.colors.accent} />
        ) : (
          <Pressable
            testID="login-submit"
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleRegister}
          >
            <Text style={styles.buttonText}>注册并进入</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: theme.colors.bg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: theme.colors.panel,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 16,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: theme.colors.muted,
    marginBottom: 24,
    textAlign: 'center',
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.colors.muted,
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: theme.colors.text,
  },
  error: {
    color: theme.colors.danger,
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  loader: {
    marginVertical: 16,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
