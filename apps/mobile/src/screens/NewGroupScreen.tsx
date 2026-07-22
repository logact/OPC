import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
type NamedParticipant = Awaited<
  ReturnType<typeof participantsApi.list>
>['participants'][number];

function MemberRow({
  participant,
  selected,
  onToggle,
}: {
  participant: NamedParticipant;
  selected: boolean;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const isAgent = participant.kind === 'agent';
  return (
    <TouchableOpacity
      style={styles.member}
      testID={`grouppick-item-${participant.id}`}
      onPress={() => onToggle(participant.id)}>
      <View
        style={[
          styles.memberAvatar,
          { backgroundColor: avatarColor(participant.id) },
        ]}>
        <Text style={styles.memberAvatarText}>
          {participant.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName} numberOfLines={1}>
            {participant.name}
          </Text>
          {isAgent ? (
            <View style={styles.agentPill}>
              <Text style={styles.agentPillText}>AGENT</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.memberSubtitle} numberOfLines={1}>
          {isAgent ? 'agent' : 'human'}
        </Text>
      </View>
      <Text style={styles.checkbox}>{selected ? '✅' : '⬜'}</Text>
    </TouchableOpacity>
  );
}

export function NewGroupScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { participantId } = useAuth();
  const { loadRooms } = useRoom();

  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState<NamedParticipant[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // All participants except the current user (prototype renderGroupPick).
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    participantsApi
      .list()
      .then(({ participants }) => {
        if (cancelled) return;
        setMembers(participants.filter((p) => p.id !== participantId));
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [participantId]);

  const handleToggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (selected.size === 0) {
      setError('Pick at least one member');
      return;
    }
    if (!participantId || isCreating) return;
    setError(null);
    setIsCreating(true);
    const name = groupName.trim() || 'New Group';
    // The creator is a member too; the server does not add them implicitly.
    const memberIds = [participantId, ...selected];
    try {
      const { roomId } = await roomsApi.create(name, memberIds);
      // System message shown at the top of the new room (prototype createGroup).
      // Best-effort: a failed broadcast must not strand the user off the room.
      await roomsApi
        .broadcast(roomId, {
          content: {
            type: 'system',
            body: `Group "${name}" created · ${memberIds.length} members`,
          },
        })
        .catch(() => {});
      await loadRooms();
      navigation.replace('Room', { roomId, roomName: name });
    } catch {
      setError('Failed to create group');
      setIsCreating(false);
    }
  }, [selected, participantId, isCreating, groupName, loadRooms, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-newgroup">
      <View style={styles.navbar}>
        <TouchableOpacity
          testID="newgroup-back"
          onPress={() => navigation.goBack()}
          hitSlop={8}>
          <Text style={styles.navBack}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          New Group
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <View style={styles.form}>
        <View>
          <Text style={styles.label}>GROUP NAME</Text>
          <TextInput
            style={styles.input}
            testID="newgroup-name-input"
            placeholder="e.g. Release Crew"
            placeholderTextColor={theme.colors.muted}
            value={groupName}
            onChangeText={setGroupName}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <Text style={styles.sec}>Pick members — humans & agents can mix</Text>

        {isLoading ? (
          <ActivityIndicator
            style={styles.loader}
            color={theme.colors.accent}
          />
        ) : (
          <FlatList
            style={styles.memberList}
            data={members}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MemberRow
                participant={item}
                selected={selected.has(item.id)}
                onToggle={handleToggle}
              />
            )}
            testID="grouppick-list"
            ListEmptyComponent={
              <Text style={styles.empty}>No other participants yet</Text>
            }
          />
        )}

        <TouchableOpacity
          style={[styles.createBtn, isCreating && styles.createBtnDisabled]}
          testID="newgroup-create"
          onPress={handleCreate}
          disabled={isCreating}>
          {isCreating ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.createBtnText}>Create Group</Text>
          )}
        </TouchableOpacity>
      </View>

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
  form: {
    flex: 1,
    padding: 16,
    gap: 16,
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
  sec: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingVertical: 4,
  },
  loader: {
    marginTop: 24,
  },
  memberList: {
    flexGrow: 0,
  },
  empty: {
    textAlign: 'center',
    color: theme.colors.muted,
    marginTop: 24,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  memberInfo: {
    flex: 1,
    minWidth: 0,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
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
  agentPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.bg,
    letterSpacing: 0.4,
  },
  memberSubtitle: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  checkbox: {
    fontSize: 18,
  },
  createBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  createBtnDisabled: {
    opacity: 0.7,
  },
  createBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
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
