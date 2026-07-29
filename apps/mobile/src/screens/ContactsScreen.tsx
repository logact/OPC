import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PresencePayload } from '@logact-pub/opc-protocol';
import { roomsApi, participantsApi } from '../api/http';
import { useMqtt } from '../contexts/MqttContext';
import { useAuth } from '../hooks/useAuth';
import { useRoom } from '../hooks/useRoom';
import { theme } from '../theme';
import { avatarColor } from '../utils/avatar';
import { presenceDisplay } from '../utils/presenceDisplay';
import type { RootStackParamList } from '../navigation/types';

// Dark text on the accent2 (green) toast pill, per prototype.
const TOAST_TEXT_COLOR = '#06240f';

// participantsApi.list() is zod-parsed against the protocol ParticipantSchema,
// whose name is required — the element type already guarantees a name.
type ListedParticipant = Awaited<
  ReturnType<typeof participantsApi.list>
>['participants'][number];

// Relative last-seen label for the subtitle row (screen copy is English).
function formatLastSeen(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(elapsed) || elapsed < 60_000) return 'just now';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function ContactRow({
  contact,
  presence,
  onPress,
}: {
  contact: ListedParticipant;
  presence: ListedParticipant['presence'];
  onPress: () => void;
}): React.JSX.Element {
  const isAgent = contact.kind === 'agent';
  const isGateway = contact.kind === 'gateway';
  // Participants that never came online have no presence field — treat as offline.
  const online = presence?.online === true;
  // Agents render the 5-state presence (issue #83); humans/gateways keep the
  // binary online/offline dot.
  const agentDisplay = isAgent ? presenceDisplay(presence) : null;
  const baseSubtitle = isAgent
    ? `agent · ${contact.id} · ${agentDisplay?.label}`
    : isGateway
      ? `gateway · ${contact.id}`
      : 'human · e2e encrypted';
  const subtitle =
    !online && presence?.lastSeen
      ? `${baseSubtitle} · last seen ${formatLastSeen(presence.lastSeen)}`
      : baseSubtitle;
  return (
    <TouchableOpacity
      style={styles.contact}
      testID={`contact-item-${contact.id}`}
      onPress={onPress}>
      <View style={[styles.avatar, { backgroundColor: avatarColor(contact.id) }]}>
        <Text style={styles.avatarText}>{contact.name.charAt(0).toUpperCase()}</Text>
        <View
          testID={`contact-presence-${contact.id}`}
          style={[
            styles.presenceDot,
            {
              backgroundColor:
                agentDisplay?.color ??
                (online ? theme.colors.accent2 : theme.colors.muted),
            },
          ]}
        />
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {contact.name}
          </Text>
          {isAgent ? (
            <View style={styles.agentPill} testID={`contact-tag-agent-${contact.id}`}>
              <Text style={styles.agentPillText}>AGENT</Text>
            </View>
          ) : null}
          {isGateway ? (
            <View style={styles.gatewayPill} testID={`contact-tag-gateway-${contact.id}`}>
              <Text style={styles.agentPillText}>GATEWAY</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle} numberOfLines={1} testID={`contact-subtitle-${contact.id}`}>
          {subtitle}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function ContactsScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { participantId } = useAuth();
  const { loadRooms } = useRoom();
  const { client } = useMqtt();

  const [contacts, setContacts] = useState<ListedParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live presence payloads from opc/participants/+/presence, keyed by
  // participant id; entries absent here fall back to the fetched presence.
  const [livePresence, setLivePresence] = useState<Record<string, PresencePayload>>({});

  // All participants except the current user, sectioned by server-side kind.
  // Refetch on focus: this tab stays mounted, and agents can be added from
  // the Add Agent tab. The presence subscription lives for the focused
  // lifetime and is torn down on blur/unmount.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      participantsApi
        .list()
        .then(({ participants }) => {
          if (cancelled) return;
          setContacts(participants.filter((p) => p.id !== participantId));
          setIsLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setContacts([]);
          setIsLoading(false);
        });
      const unsubscribe = client?.subscribePresence((id, presence) => {
        setLivePresence((prev) => {
          const current = prev[id];
          return current?.online === presence.online && current?.status === presence.status
            ? prev
            : { ...prev, [id]: presence };
        });
      });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }, [participantId, client]),
  );

  // Fetched presence (with lastSeen) overlaid with any live presence update;
  // a live payload without status keeps the fetched agent status.
  const presenceFor = (p: ListedParticipant): ListedParticipant['presence'] => {
    const live = livePresence[p.id];
    if (live === undefined) return p.presence;
    return {
      online: live.online,
      lastSeen: p.presence?.lastSeen ?? '',
      status: live.status ?? p.presence?.status,
    };
  };

  // Client-side filter over all sections (prototype search box).
  const { agents, gateways, humans } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (p: ListedParticipant) =>
      q === '' || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    return {
      agents: contacts.filter((p) => p.kind === 'agent' && matches(p)),
      gateways: contacts.filter((p) => p.kind === 'gateway' && matches(p)),
      humans: contacts.filter((p) => p.kind === 'human' && matches(p)),
    };
  }, [contacts, query]);

  // Find-or-create the 1v1 room and enter it. The server's direct-room route
  // dedupes by the participant pair and stamps metadata { type: 'direct' },
  // so ChatScreen does not render the room as a group.
  const handleOpen = useCallback(
    async (contact: ListedParticipant) => {
      if (!participantId || isOpening) return;
      setError(null);
      setIsOpening(true);
      try {
        const { roomId } = await roomsApi.createDirect([participantId, contact.id]);
        await loadRooms();
        navigation.navigate('Room', { roomId, roomName: contact.name });
      } catch {
        setError('Failed to open chat');
      } finally {
        setIsOpening(false);
      }
    },
    [participantId, isOpening, loadRooms, navigation],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-contacts">
      <View style={styles.navbar}>
        <Text style={styles.navTitle}>Contacts</Text>
        <TouchableOpacity
          testID="contacts-add-agent-btn"
          onPress={() => navigation.navigate('MainTabs', { screen: 'AddAgent' })}
          hitSlop={8}>
          <Text style={styles.navAction}>⊕</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        testID="contacts-search"
        placeholder="🔍 Search contacts"
        placeholderTextColor={theme.colors.muted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.accent} />
      ) : (
        <ScrollView style={styles.flex}>
          {agents.length > 0 ? (
            <>
              <Text style={styles.sec} testID="contacts-section-agents">
                AI Agents
              </Text>
              {agents.map((p) => (
                <ContactRow key={p.id} contact={p} presence={presenceFor(p)} onPress={() => handleOpen(p)} />
              ))}
            </>
          ) : null}
          {gateways.length > 0 ? (
            <>
              <Text style={styles.sec} testID="contacts-section-gateways">
                Gateways
              </Text>
              {gateways.map((p) => (
                <ContactRow key={p.id} contact={p} presence={presenceFor(p)} onPress={() => handleOpen(p)} />
              ))}
            </>
          ) : null}
          {humans.length > 0 ? (
            <>
              <Text style={styles.sec} testID="contacts-section-humans">
                Humans
              </Text>
              {humans.map((p) => (
                <ContactRow key={p.id} contact={p} presence={presenceFor(p)} onPress={() => handleOpen(p)} />
              ))}
            </>
          ) : null}
          {agents.length === 0 && gateways.length === 0 && humans.length === 0 ? (
            <Text style={styles.empty}>No contacts</Text>
          ) : null}
        </ScrollView>
      )}

      {error ? (
        <View style={styles.toast} testID="toast">
          <Text style={styles.toastText}>{error}</Text>
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
  navAction: {
    color: theme.colors.accent,
    fontSize: 22,
  },
  search: {
    marginHorizontal: 14,
    marginVertical: 10,
    backgroundColor: theme.colors.panel2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: theme.colors.text,
    fontSize: 14,
  },
  loader: {
    marginTop: 24,
  },
  sec: {
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  // Same dot geometry as the Me screen's onlineDot; color is set inline.
  presenceDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2.5,
    borderColor: theme.colors.bg,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
    flexShrink: 1,
  },
  // Solid AGENT tag, same as the message who-row tag (prototype .tag-agent).
  agentPill: {
    backgroundColor: theme.colors.agent,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  gatewayPill: {
    backgroundColor: theme.colors.accent,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  agentPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.bg,
    letterSpacing: 0.4,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  empty: {
    textAlign: 'center',
    color: theme.colors.muted,
    marginTop: 24,
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
