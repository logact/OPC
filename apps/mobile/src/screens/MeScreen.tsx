import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getAgents } from '../agents/registry';
import { useAuth } from '../hooks/useAuth';
import { theme } from '../theme';

// Profile avatar background per prototype (UI/prototype.html `#s-me .avatar`);
// kept local rather than in theme.ts.
const PROFILE_AVATAR_BG = '#334155';

// Same inline tile background as RoomInfoScreen's settings rows.
const SETTINGS_ICON_TILE_BG = '#1e293b';

// No real DID exists yet; fabricate a stable short suffix from the
// participant id so the profile card always shows the same did for the
// same user (prototype: `local-first node · did:opc:8f3a…c21e`).
function didSuffix(id: string): string {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < id.length; i += 1) {
    h1 = (h1 * 31 + id.charCodeAt(i)) >>> 0;
    h2 = (h2 * 131 + id.charCodeAt(i)) >>> 0;
  }
  const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

// Static workspace rows (prototype "Me" screen). Relay/E2E/Settings have no
// backing data yet, so they are display-only; the agents row gets its count
// from the local registry.
const WORKSPACE_ROWS = [
  {
    testID: 'me-row-agents',
    icon: '🖥️',
    title: 'My Agents',
  },
  {
    testID: 'me-row-relay',
    icon: '☁️',
    title: 'Relay Server',
    subtitle: 'frp → cloud · connected',
  },
  {
    testID: 'me-row-e2e',
    icon: '🔐',
    title: 'E2E Encryption',
    subtitle: 'signal protocol · on',
  },
  {
    testID: 'me-row-settings',
    icon: '⚙️',
    title: 'Settings',
    subtitle: 'sync · notifications · storage',
  },
] as const;

export function MeScreen(): React.JSX.Element {
  const { participantId, logout } = useAuth();

  const [agentCount, setAgentCount] = useState(0);

  // Agent count comes from the local registry; refresh on focus since agents
  // can be added from the Add Agent tab while this screen stays mounted.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getAgents()
        .then((agents) => {
          if (!cancelled) setAgentCount(agents.length);
        })
        .catch(() => {
          if (!cancelled) setAgentCount(0);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const displayName = participantId ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-me">
      <View style={styles.navbar}>
        <Text style={styles.navTitle}>Me</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.flex}>
        <View style={styles.profile} testID="me-profile">
          <View style={styles.avatar} testID="me-avatar">
            <Text style={styles.avatarText}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
            {/* Presence is statically online here — it's the user themself. */}
            <View style={styles.onlineDot} />
          </View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1} testID="me-name">
              {displayName}
            </Text>
            <Text style={styles.endpoint} numberOfLines={1} testID="me-endpoint">
              {`local-first node · did:opc:${didSuffix(displayName)}`}
            </Text>
          </View>
        </View>

        <Text style={styles.sec}>Workspace</Text>
        <View>
          {WORKSPACE_ROWS.map((row) => (
            <View key={row.testID} testID={row.testID} style={styles.row}>
              <View style={styles.rowIcon}>
                <Text style={styles.rowIconText}>{row.icon}</Text>
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowSubtitle} numberOfLines={1}>
                  {'subtitle' in row
                    ? row.subtitle
                    : `${agentCount} remote`}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Logout affordance (beyond prototype): auth-state-driven navigation
            returns to Login automatically once credentials are cleared. */}
        <TouchableOpacity
          style={styles.logout}
          testID="me-logout"
          onPress={() => {
            void logout();
          }}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
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
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: PROFILE_AVATAR_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: theme.colors.accent2,
    borderWidth: 2.5,
    borderColor: theme.colors.bg,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
  },
  endpoint: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: SETTINGS_ICON_TILE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconText: {
    fontSize: 20,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  rowSubtitle: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  logout: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  logoutText: {
    color: theme.colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});
