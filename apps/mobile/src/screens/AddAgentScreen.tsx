import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { roomsApi, participantsApi, setAuthToken } from '../api/http';
import { saveAgent, type AgentProtocol } from '../agents/registry';
import { useAuth } from '../hooks/useAuth';
import { useRoom } from '../hooks/useRoom';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation/types';

// Dark text on the accent2 (green) toast pill, per prototype.
const TOAST_TEXT_COLOR = '#06240f';

const PROTOCOLS: AgentProtocol[] = ['A2A', 'ACP', 'WebSocket'];

// Prototype preselects code + schedule.
const CAPABILITIES = ['code', 'research', 'translate', 'devops', 'schedule', 'design'] as const;
const DEFAULT_CAPS: readonly string[] = ['code', 'schedule'];

const HINT =
  'Connect an agent already deployed on a remote server. It will appear in your contacts and can join 1v1 or group chats — the IM invokes it over its endpoint.';

// Slug id from the display name, with a short random suffix for uniqueness.
function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'agent'}-${suffix}`;
}

export function AddAgentScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { participantId, token } = useAuth();
  const { loadRooms } = useRoom();

  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [protocol, setProtocol] = useState<AgentProtocol>('A2A');
  const [caps, setCaps] = useState<ReadonlySet<string>>(new Set(DEFAULT_CAPS));
  const [isAdding, setIsAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleToggleCap = useCallback((cap: string) => {
    setCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
      } else {
        next.add(cap);
      }
      return next;
    });
  }, []);

  const handleAdd = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedEndpoint = endpoint.trim();
    if (!trimmedName || !trimmedEndpoint) {
      setToast('Name and endpoint required');
      return;
    }
    if (!participantId || !token || isAdding) return;
    setToast(null);
    setIsAdding(true);
    try {
      // Register the agent as a participant, then flip kind to 'agent' with
      // the NEW participant's own token — same sequence as
      // .maestro/scripts/seed-participants.js.
      const agentId = slugify(trimmedName);
      const { token: agentToken } = await participantsApi.register(agentId, trimmedName);
      setAuthToken(agentToken);
      try {
        await participantsApi.update(agentId, { kind: 'agent' });
      } finally {
        setAuthToken(token);
      }
      // Only persist locally once the server-side registration succeeded.
      await saveAgent({
        id: agentId,
        name: trimmedName,
        endpoint: trimmedEndpoint,
        protocol,
        capabilities: [...caps],
      });
      setToast(`Connected to ${trimmedEndpoint} — agent added ✓`);
      // Reset the form so re-entering the tab starts clean (prototype addAgent).
      setName('');
      setEndpoint('');
      setProtocol('A2A');
      setCaps(new Set(DEFAULT_CAPS));
      // Auto-open the 1v1 DM with the new agent. A failure here must not mask
      // the successful registration above — the agent is already added, so the
      // success toast stands and we just stay on this screen.
      try {
        const { roomId } = await roomsApi.createDirect([participantId, agentId]);
        await loadRooms();
        navigation.navigate('Room', { roomId, roomName: trimmedName });
      } catch {
        // DM open failed; agent was still registered successfully.
      }
    } catch (err) {
      setToast(
        err instanceof Error && err.message
          ? `Failed to add agent — ${err.message}`
          : 'Failed to add agent',
      );
    } finally {
      setIsAdding(false);
    }
  }, [name, endpoint, protocol, caps, participantId, token, isAdding, loadRooms, navigation]);

  // Auto-dismiss the toast after ~3s; cleared early on unmount or next toast.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-addagent">
      <View style={styles.navbar}>
        <Text style={styles.navTitle}>Add Remote Agent</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
        <Text style={styles.hint} testID="addagent-hint">
          {HINT}
        </Text>

        <View>
          <Text style={styles.label}>AGENT NAME</Text>
          <TextInput
            style={styles.input}
            testID="addagent-name-input"
            placeholder="e.g. Code Reviewer"
            placeholderTextColor={theme.colors.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View>
          <Text style={styles.label}>REMOTE ENDPOINT</Text>
          <TextInput
            style={styles.input}
            testID="addagent-endpoint-input"
            placeholder="https://agent.example.com:8443"
            placeholderTextColor={theme.colors.muted}
            value={endpoint}
            onChangeText={setEndpoint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        <View>
          <Text style={styles.label}>PROTOCOL</Text>
          <View style={styles.protoRow}>
            {PROTOCOLS.map((p) => {
              const selected = protocol === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.proto, selected && styles.protoOn]}
                  testID={`addagent-proto-${p}`}
                  onPress={() => setProtocol(p)}>
                  <Text style={[styles.protoText, selected && styles.protoTextOn]}>{p}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View>
          <Text style={styles.label}>CAPABILITIES</Text>
          <View style={styles.capsPick}>
            {CAPABILITIES.map((cap) => {
              const selected = caps.has(cap);
              return (
                <TouchableOpacity
                  key={cap}
                  style={[styles.cap, selected && styles.capOn]}
                  testID={`addagent-cap-${cap}`}
                  onPress={() => handleToggleCap(cap)}>
                  <Text style={[styles.capText, selected && styles.capTextOn]}>{cap}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, isAdding && styles.primaryBtnDisabled]}
          testID="addagent-submit"
          onPress={handleAdd}
          disabled={isAdding}>
          {isAdding ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryBtnText}>Test Connection & Add</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.ghostBtn}
          testID="addagent-cancel"
          onPress={() => navigation.navigate('MainTabs', { screen: 'Chats' })}>
          <Text style={styles.ghostBtnText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>

      {toast ? (
        <View style={styles.toast} testID="toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
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
  navTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  navSpacer: {
    width: 22,
  },
  form: {
    padding: 16,
    gap: 16,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.muted,
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    color: theme.colors.text,
    fontSize: 14,
  },
  protoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  proto: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel2,
  },
  protoOn: {
    borderColor: theme.colors.accent,
    backgroundColor: '#4f7cff1a',
  },
  protoText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.muted,
  },
  protoTextOn: {
    color: theme.colors.accent,
  },
  capsPick: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cap: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel2,
  },
  capOn: {
    borderColor: theme.colors.agent,
    backgroundColor: '#a78bfa1a',
  },
  capText: {
    fontSize: 12,
    color: theme.colors.muted,
  },
  capTextOn: {
    color: theme.colors.agent,
  },
  primaryBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  ghostBtnText: {
    color: theme.colors.muted,
    fontSize: 14,
  },
  toast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: theme.colors.accent2,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toastText: {
    color: TOAST_TEXT_COLOR,
    fontSize: 13,
    fontWeight: '700',
  },
});
