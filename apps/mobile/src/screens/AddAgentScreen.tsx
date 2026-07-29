import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GatewayModelCatalogSchema } from '@logact-pub/opc-protocol';
import { roomsApi, participantsApi } from '../api/http';
import { useAuth } from '../hooks/useAuth';
import { useRoom } from '../hooks/useRoom';
import { theme } from '../theme';
import { avatarColor } from '../utils/avatar';
import type { RootStackParamList } from '../navigation/types';

// Dark text on the accent2 (green) toast pill, per prototype.
const TOAST_TEXT_COLOR = '#06240f';

// participantsApi.list() is zod-parsed against the protocol ParticipantSchema,
// whose name is required — the element type already guarantees a name.
type ListedParticipant = Awaited<
  ReturnType<typeof participantsApi.list>
>['participants'][number];

// pi-ai provider ids supported by the edge runtime (EdgeModelOptions).
// Used only as fallback when the selected gateway has not reported a model catalog.
const PROVIDERS = ['anthropic', 'openai', 'google', 'deepseek', 'openrouter'] as const;
type Provider = (typeof PROVIDERS)[number];
const DEFAULT_PROVIDER: Provider = 'anthropic';

const HINT =
  'Pick the gateway that will run your agent, then tell it which model to use. The gateway spawns the agent and it appears in your contacts.';

const GATEWAYS_EMPTY_HINT =
  'No gateway registered yet. Start one on an edge machine: npm install -g @opc-pub/agent-edge-app && opc-gateway start';

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

function GatewayRow({
  gateway,
  selected,
  onSelect,
}: {
  gateway: ListedParticipant;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.gateway, selected && styles.gatewayOn]}
      testID={`addagent-gateway-item-${gateway.id}`}
      onPress={() => onSelect(gateway.id)}>
      <View style={[styles.gatewayAvatar, { backgroundColor: avatarColor(gateway.id) }]}>
        <Text style={styles.gatewayAvatarText}>{gateway.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.gatewayInfo}>
        <Text style={styles.gatewayName} numberOfLines={1}>
          {gateway.name}
        </Text>
        <Text style={styles.gatewayId} numberOfLines={1}>
          {gateway.id}
        </Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </TouchableOpacity>
  );
}

export function AddAgentScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { participantId, token } = useAuth();
  const { loadRooms } = useRoom();

  const [gateways, setGateways] = useState<ListedParticipant[]>([]);
  const [isLoadingGateways, setIsLoadingGateways] = useState(true);
  const [selectedGatewayId, setSelectedGatewayId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<string>(DEFAULT_PROVIDER);
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Model catalog reported by the selected gateway (metadata.modelCatalog).
  // When present, provider/model options come from the catalog; otherwise the
  // screen falls back to the hardcoded providers + free-text model id.
  const catalog = useMemo(() => {
    const gateway = gateways.find((g) => g.id === selectedGatewayId);
    const parsed = GatewayModelCatalogSchema.safeParse(gateway?.metadata?.modelCatalog);
    // 空 catalog（无 provider）视为无 catalog，走 fallback
    return parsed.success && parsed.data.providers.length > 0 ? parsed.data : null;
  }, [gateways, selectedGatewayId]);

  const providerIds = useMemo<readonly string[]>(
    () => (catalog ? catalog.providers.map((p) => p.provider) : PROVIDERS),
    [catalog],
  );
  // Stale provider state (e.g. default) snaps to the catalog's first provider.
  const effectiveProvider = providerIds.includes(provider)
    ? provider
    : (providerIds[0] ?? DEFAULT_PROVIDER);
  const catalogModels = useMemo(
    () => catalog?.providers.find((p) => p.provider === effectiveProvider)?.models ?? [],
    [catalog, effectiveProvider],
  );

  const loadGateways = useCallback(async () => {
    setIsLoadingGateways(true);
    try {
      const { participants } = await participantsApi.list({ kind: 'gateway' });
      setGateways(participants);
      // A single gateway is the common case — preselect it. Tapping a row is
      // select-only (never deselects), so re-selecting the same id is safe.
      setSelectedGatewayId((prev) =>
        prev && participants.some((g) => g.id === prev)
          ? prev
          : participants.length === 1
            ? (participants[0]?.id ?? null)
            : null,
      );
    } catch {
      setGateways([]);
      setToast('Failed to load gateways');
    } finally {
      setIsLoadingGateways(false);
    }
  }, []);

  // This tab stays mounted; gateways can appear after the screen first
  // renders, so refetch every time it gains focus.
  useFocusEffect(
    useCallback(() => {
      void loadGateways();
    }, [loadGateways]),
  );

  const handleAdd = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedModelId = modelId.trim();
    const trimmedApiKey = apiKey.trim();
    if (!selectedGatewayId) {
      setToast('Select a gateway first');
      return;
    }
    if (!trimmedName || !trimmedModelId) {
      setToast('Name and model id required');
      return;
    }
    if (!participantId || !token || isAdding) return;
    setToast(null);
    setIsAdding(true);
    try {
      // Registering with kind 'agent' + gatewayId makes the server dispatch an
      // agent.spawn command to that gateway with the model config.
      const agentId = slugify(trimmedName);
      await participantsApi.register(agentId, {
        name: trimmedName,
        kind: 'agent',
        gatewayId: selectedGatewayId,
        model: {
          provider: effectiveProvider,
          modelId: trimmedModelId,
          ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
        },
      });
      setToast(`Agent added — ${trimmedName} ✓`);
      // Reset the form so re-entering the tab starts clean.
      setName('');
      setProvider(DEFAULT_PROVIDER);
      setModelId('');
      setApiKey('');
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
  }, [name, modelId, apiKey, effectiveProvider, selectedGatewayId, participantId, token, isAdding, loadRooms, navigation]);

  // Auto-dismiss the toast after ~3s; cleared early on unmount or next toast.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-addagent">
      <View style={styles.navbar}>
        <Text style={styles.navTitle}>Add Agent</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
        <Text style={styles.hint} testID="addagent-hint">
          {HINT}
        </Text>

        <View>
          <View style={styles.labelRow}>
            <Text style={styles.label}>1 · GATEWAY</Text>
            <TouchableOpacity
              testID="addagent-gateways-refresh"
              onPress={() => void loadGateways()}
              hitSlop={8}>
              <Text style={styles.refresh}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {isLoadingGateways ? (
            <ActivityIndicator
              style={styles.gatewayLoader}
              color={theme.colors.accent}
              testID="addagent-gateways-loading"
            />
          ) : gateways.length === 0 ? (
            <Text style={styles.emptyGateways} testID="addagent-gateways-empty">
              {GATEWAYS_EMPTY_HINT}
            </Text>
          ) : (
            <View style={styles.gatewayList} testID="addagent-gateway-list">
              {gateways.map((g) => (
                <GatewayRow
                  key={g.id}
                  gateway={g}
                  selected={g.id === selectedGatewayId}
                  onSelect={setSelectedGatewayId}
                />
              ))}
            </View>
          )}
        </View>

        <View>
          <Text style={styles.label}>2 · AGENT NAME</Text>
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
          <Text style={styles.label}>PROVIDER</Text>
          <View style={styles.providerPick}>
            {providerIds.map((p) => {
              const selected = effectiveProvider === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.providerChip, selected && styles.providerChipOn]}
                  testID={`addagent-provider-${p}`}
                  onPress={() => setProvider(p)}>
                  <Text style={[styles.providerText, selected && styles.providerTextOn]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {catalog ? (
          <View>
            <Text style={styles.label}>MODEL</Text>
            <View style={styles.providerPick}>
              {catalogModels.map((m) => {
                const selected = modelId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.providerChip, selected && styles.providerChipOn]}
                    testID={`addagent-model-item-${m.id}`}
                    onPress={() => setModelId(m.id)}>
                    <Text style={[styles.providerText, selected && styles.providerTextOn]}>
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : (
          <View>
            <Text style={styles.label}>MODEL ID</Text>
            <TextInput
              style={styles.input}
              testID="addagent-model-input"
              placeholder="e.g. claude-sonnet-4-5"
              placeholderTextColor={theme.colors.muted}
              value={modelId}
              onChangeText={setModelId}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        <View>
          <Text style={styles.label}>API KEY (OPTIONAL)</Text>
          <TextInput
            style={styles.input}
            testID="addagent-apikey-input"
            placeholder="Defaults to the gateway's provider key"
            placeholderTextColor={theme.colors.muted}
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, isAdding && styles.primaryBtnDisabled]}
          testID="addagent-submit"
          onPress={handleAdd}
          disabled={isAdding}>
          {isAdding ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryBtnText}>Add Agent</Text>
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.colors.muted,
    marginBottom: 6,
  },
  refresh: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.colors.accent,
    marginBottom: 6,
  },
  gatewayLoader: {
    marginVertical: 12,
  },
  emptyGateways: {
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
  gatewayList: {
    gap: 8,
  },
  gateway: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  gatewayOn: {
    borderColor: theme.colors.accent,
    backgroundColor: '#4f7cff1a',
  },
  gatewayAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayAvatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  gatewayInfo: {
    flex: 1,
    minWidth: 0,
  },
  gatewayName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  gatewayId: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 1,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: theme.colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.accent,
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
  providerPick: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  providerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel2,
  },
  providerChipOn: {
    borderColor: theme.colors.accent,
    backgroundColor: '#4f7cff1a',
  },
  providerText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.muted,
  },
  providerTextOn: {
    color: theme.colors.accent,
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
