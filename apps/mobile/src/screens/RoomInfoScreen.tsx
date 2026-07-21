import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { Participant } from '@opc/api-client';
import { roomsApi, participantsApi } from '../api/http';
import { useAuth } from '../hooks/useAuth';
import { theme } from '../theme';
import { avatarColor } from '../utils/avatar';

// Protocol guarantees a name on every participant (ParticipantSchema.name is
// required); the api-client's local interface still types it as nullable, so
// narrow once at the boundary instead of falling back at render time.
type NamedParticipant = Participant & { name: string };

// Inline tile background used for the settings icon tiles in the prototype
// (UI/prototype.html `.contact .avatar`); kept local rather than in theme.ts.
const SETTINGS_ICON_TILE_BG = '#1e293b';

// Static settings rows (prototype "Chat Info" screen). No backing data exists
// yet, so these are display-only.
const SETTINGS_ROWS = [
  {
    testID: 'roominfo-row-notifications',
    icon: '🔔',
    title: 'Notifications',
    subtitle: 'mentions only',
  },
  {
    testID: 'roominfo-row-pinned',
    icon: '📌',
    title: 'Pinned Messages',
    subtitle: '0',
  },
  {
    testID: 'roominfo-row-agent-perms',
    icon: '🤖',
    title: 'Agent Permissions',
    subtitle: 'agents reply when @mentioned',
  },
  {
    testID: 'roominfo-row-history',
    icon: '📜',
    title: 'History Sync',
    subtitle: 'offline-first · full history',
  },
] as const;

export function RoomInfoScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute();
  const { roomId } = route.params as { roomId: string };
  const { participantId } = useAuth();

  const [members, setMembers] = useState<NamedParticipant[]>([]);

  // Load the room, then each participant; individual failures skip that chip.
  useEffect(() => {
    let cancelled = false;
    setMembers([]);
    roomsApi
      .get(roomId)
      .then(async ({ room }) => {
        const entries = await Promise.all(
          room.participantIds.map(async (id) => {
            try {
              const { participant } = await participantsApi.get(id);
              return participant;
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        setMembers(
          entries.filter(
            (p): p is NamedParticipant => p !== null && typeof p.name === 'string',
          ),
        );
      })
      .catch(() => {
        // Room lookup failed: leave the members row empty.
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Current user first, labeled 'You' (prototype renderMembers).
  const orderedMembers = useMemo(() => {
    const self = members.find((p) => p.id === participantId);
    const rest = members.filter((p) => p.id !== participantId);
    return self ? [self, ...rest] : rest;
  }, [members, participantId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-roominfo">
      <View style={styles.navbar}>
        <TouchableOpacity
          testID="roominfo-back"
          onPress={() => navigation.goBack()}
          hitSlop={8}>
          <Text style={styles.navBack}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          Chat Info
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.flex}>
        <Text style={styles.sec}>Members</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.memberRow}
          testID="member-row">
          {orderedMembers.map((p) => {
            const isSelf = p.id === participantId;
            const isAgent = p.kind === 'agent';
            const name = isSelf ? 'You' : p.name;
            return (
              <View
                key={p.id}
                style={styles.member}
                testID={`member-${p.id}`}>
                <View
                  style={[
                    styles.memberAvatar,
                    { backgroundColor: avatarColor(p.id) },
                  ]}>
                  <Text style={styles.memberAvatarText}>
                    {p.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.memberName} numberOfLines={1}>
                  {name}
                  {isAgent && !isSelf ? ' 🤖' : ''}
                </Text>
              </View>
            );
          })}
          <TouchableOpacity
            style={styles.member}
            testID="member-invite"
            onPress={() => {
              // Invite flow not built yet (prototype shows a toast).
            }}>
            <View style={[styles.memberAvatar, styles.inviteAvatar]}>
              <Text style={styles.inviteAvatarText}>＋</Text>
            </View>
            <Text style={styles.memberName} numberOfLines={1}>
              Invite
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <Text style={styles.sec}>Settings</Text>
        <View>
          {SETTINGS_ROWS.map((row) => (
            <View
              key={row.testID}
              testID={row.testID}
              style={styles.settingsRow}>
              <View style={styles.settingsIcon}>
                <Text style={styles.settingsIconText}>{row.icon}</Text>
              </View>
              <View style={styles.settingsInfo}>
                <Text style={styles.settingsTitle}>{row.title}</Text>
                <Text style={styles.settingsSubtitle} numberOfLines={1}>
                  {row.subtitle}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
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
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
  },
  navBack: {
    color: theme.colors.accent,
    fontSize: 15,
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginHorizontal: 8,
  },
  navSpacer: {
    width: 40,
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
  memberRow: {
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  member: {
    alignItems: 'center',
    gap: 5,
    width: 56,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  memberName: {
    fontSize: 10.5,
    color: theme.colors.muted,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  inviteAvatar: {
    backgroundColor: theme.colors.panel2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.line,
  },
  inviteAvatarText: {
    color: theme.colors.muted,
    fontSize: 17,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  settingsIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: SETTINGS_ICON_TILE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIconText: {
    fontSize: 18,
  },
  settingsInfo: {
    flex: 1,
    minWidth: 0,
  },
  settingsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  settingsSubtitle: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
});
