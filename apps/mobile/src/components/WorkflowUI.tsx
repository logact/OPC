import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';

export function WorkflowScreen({
  children,
  testID,
  scroll = true,
}: {
  children: ReactNode;
  testID: string;
  scroll?: boolean;
}) {
  const content = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.flex}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID={testID}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function WorkflowHeader({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerSide} />
      )}
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSide}>{action}</View>
    </View>
  );
}

export function SectionTitle({ children, testID }: { children: ReactNode; testID?: string }) {
  return <Text testID={testID} style={styles.section}>{children}</Text>;
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        style={[styles.input, props.multiline && styles.textarea, props.style]}
        placeholderTextColor={theme.colors.muted}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function ActionButton({
  title,
  onPress,
  testID,
  disabled = false,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.disabled,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'secondary' && styles.buttonTextSecondary,
        ]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const body = (
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
      {label}
    </Text>
  );
  return onPress ? (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {body}
    </TouchableOpacity>
  ) : (
    <View
      testID={testID}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {body}
    </View>
  );
}

export function Card({
  children,
  testID,
  onPress,
}: {
  children: ReactNode;
  testID?: string;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <TouchableOpacity testID={testID} onPress={onPress} style={styles.card}>
        {children}
      </TouchableOpacity>
    );
  }
  return (
    <View testID={testID} style={styles.card}>
      {children}
    </View>
  );
}

export function InlineNotice({
  message,
  tone = 'error',
  onRetry,
}: {
  message: string;
  tone?: 'error' | 'info';
  onRetry?: () => void;
}) {
  return (
    <View style={[styles.notice, tone === 'info' && styles.noticeInfo]}>
      <Text style={styles.noticeText}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity onPress={onRetry}>
          <Text style={styles.retry}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.state}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <Text style={styles.empty}>{label}</Text>;
}

export function Toast({ message }: { message: string | null }) {
  return message ? (
    <View style={styles.toast} testID="toast">
      <Text style={styles.toastText}>{message}</Text>
    </View>
  ) : null;
}

export const workflowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  body: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  link: { color: theme.colors.accent, fontSize: 13, fontWeight: '600' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.line,
    marginVertical: 10,
  },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  content: { paddingBottom: 32 },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: theme.colors.panel,
    borderBottomColor: theme.colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { width: 64, alignItems: 'flex-end' },
  headerTitle: {
    flex: 1,
    color: theme.colors.text,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },
  back: { width: 64, color: theme.colors.accent, fontSize: 14 },
  section: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 14,
  },
  field: { paddingHorizontal: 14, marginTop: 14 },
  label: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    color: theme.colors.text,
    backgroundColor: theme.colors.panel2,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  fieldError: { color: theme.colors.danger, fontSize: 12, marginTop: 5 },
  button: {
    marginHorizontal: 14,
    marginTop: 14,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonSecondary: {
    backgroundColor: theme.colors.panel2,
    borderColor: theme.colors.line,
    borderWidth: 1,
  },
  buttonDanger: { backgroundColor: theme.colors.danger },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  buttonTextSecondary: { color: theme.colors.text },
  disabled: { opacity: 0.45 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel2,
  },
  chipSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: '#16254d',
  },
  chipText: { color: theme.colors.muted, fontSize: 12 },
  chipTextSelected: { color: theme.colors.text, fontWeight: '600' },
  card: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
  },
  notice: {
    margin: 14,
    padding: 12,
    borderRadius: 10,
    borderColor: theme.colors.danger,
    borderWidth: 1,
    backgroundColor: '#2a1318',
  },
  noticeInfo: { borderColor: theme.colors.accent, backgroundColor: '#111d3b' },
  noticeText: { color: theme.colors.text, fontSize: 13 },
  retry: { color: theme.colors.accent, fontWeight: '700', marginTop: 8 },
  state: { padding: 30, gap: 10, alignItems: 'center' },
  muted: { color: theme.colors.muted, fontSize: 13 },
  empty: { color: theme.colors.muted, textAlign: 'center', padding: 32 },
  toast: {
    position: 'absolute',
    top: 62,
    alignSelf: 'center',
    zIndex: 30,
    maxWidth: '88%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: theme.colors.danger,
  },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
