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

type Mode = 'login' | 'register';

export function LoginScreen(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('login');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const { login, register, isLoading, error, clearError } = useAuth();

  const switchMode = (next: Mode) => {
    clearError();
    setValidationError(null);
    setMode(next);
  };

  const handleSubmit = async () => {
    clearError();
    // 行内错误而非原生 Alert：iOS 26.5 simulator 上 XCUITest 看不到
    // Alert 窗口，e2e 无法关闭它；本屏幕的错误本来就行内展示。
    if (!id.trim()) {
      setValidationError('请输入参与者 ID');
      return;
    }
    if (!password) {
      setValidationError(mode === 'login' ? '请输入密码' : '请设置登录密码（至少 6 位）');
      return;
    }
    if (mode === 'register' && password.length < 6) {
      setValidationError('请设置登录密码（至少 6 位）');
      return;
    }
    setValidationError(null);
    if (mode === 'login') {
      await login(id.trim(), password);
    } else {
      await register(id.trim(), name.trim() || undefined, password);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>OPC Mobile</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' ? '使用账号密码登录 OPC-server' : '在新服务器上注册第一个人类账号'}
        </Text>

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
          <Text style={styles.label}>密码</Text>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            placeholder={mode === 'login' ? '登录密码（必填）' : '登录密码（至少 6 位）'}
            placeholderTextColor={theme.colors.muted}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>
        {mode === 'register' ? (
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
        ) : null}

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
            onPress={handleSubmit}
          >
            <Text style={styles.buttonText}>
              {mode === 'login' ? '登录' : '注册并进入'}
            </Text>
          </Pressable>
        )}

        <Pressable
          testID="login-toggle-mode"
          accessibilityRole="button"
          style={styles.toggle}
          onPress={() => switchMode(mode === 'login' ? 'register' : 'login')}
        >
          <Text style={styles.toggleText}>
            {mode === 'login' ? '全新服务器？注册首个账号' : '已有账号？返回登录'}
          </Text>
        </Pressable>
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
  toggle: {
    marginTop: 16,
    alignItems: 'center',
  },
  toggleText: {
    color: theme.colors.muted,
    fontSize: 13,
  },
});
