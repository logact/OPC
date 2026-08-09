import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useRoom } from '../hooks/useRoom';
import { participantsApi } from '../api/http';
import { useAuthStore } from '../stores/authStore';
import { theme } from '../theme';
import { avatarColor } from '../utils/avatar';
import type { Room } from '../stores/roomStore';

function formatConversationTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toTimeString().slice(0, 5);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function unreadBadgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function ConversationRow({
  room,
  displayName,
  selfId,
  onPress,
}: {
  room: Room;
  displayName: string;
  selfId: string | null;
  onPress: (room: Room) => void;
}): React.JSX.Element {
  const lastMessage = room.lastMessage;
  const preview = lastMessage
    ? `${lastMessage.from === selfId ? 'You' : lastMessage.from}: ${lastMessage.content.body}`
    : undefined;
  const unreadCount = room.unreadCount;
  return (
    <TouchableOpacity
      style={styles.conv}
      testID={`conv-item-${room.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${displayName}${unreadCount > 0 ? `, ${unreadCount} unread messages` : ''}`}
      accessibilityHint="Open conversation"
      onPress={() => onPress(room)}>
      <View
        style={[styles.avatar, { backgroundColor: avatarColor(room.id) }]}
        testID={`conv-avatar-${room.id}`}>
        <Text style={styles.avatarText}>
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.convMid}>
        <View style={styles.convHeader}>
          <Text
            style={styles.convName}
            numberOfLines={1}
            testID={`conv-name-${room.id}`}>
            {displayName}
          </Text>
          {lastMessage ? (
            <Text style={styles.time} testID={`conv-time-${room.id}`}>
              {formatConversationTime(lastMessage.timestamp)}
            </Text>
          ) : null}
        </View>
        {preview ? (
          <Text
            style={styles.preview}
            numberOfLines={1}
            testID={`conv-preview-${room.id}`}>
            {preview}
          </Text>
        ) : null}
      </View>
      {unreadCount > 0 ? (
        <View
          style={styles.unreadBadge}
          testID={`conv-unread-${room.id}`}
          accessible
          accessibilityLabel={`${unreadCount} unread messages`}>
          <Text style={styles.unreadBadgeText}>{unreadBadgeText(unreadCount)}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export function RoomListScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { rooms, isLoadingRooms, error, loadRooms } = useRoom();
  const [query, setQuery] = useState('');
  const selfId = useAuthStore((state) => state.participantId);
  // Resolved display names for direct rooms, keyed by room id.
  const [directNames, setDirectNames] = useState<Record<string, string>>({});
  const resolvedRoomIds = useRef(new Set<string>());

  // Refetch on focus: this screen stays mounted in the stack while Room /
  // NewGroup are pushed, so a mount-only effect would leave the list stale
  // after creating a group or sending a message (same pattern as ContactsScreen).
  useFocusEffect(
    useCallback(() => {
      if (selfId) void loadRooms(selfId);
    }, [loadRooms, selfId])
  );

  // Direct rooms are named `${participantA}-${participantB}` by the server;
  // resolve the other participant's name once per room and fall back to the
  // raw room name on any failure.
  useEffect(() => {
    for (const room of rooms) {
      if (resolvedRoomIds.current.has(room.id)) continue;
      resolvedRoomIds.current.add(room.id);
      if (room.metadata?.type !== 'direct' || room.participantIds?.length !== 2) {
        continue;
      }
      const otherId = room.participantIds.find((id) => id !== selfId);
      if (!otherId) continue;
      participantsApi
        .get(otherId)
        .then(({ participant }) => {
          const name = participant.name;
          if (name) {
            setDirectNames((prev) => ({ ...prev, [room.id]: name }));
          }
        })
        .catch(() => {
          // keep the raw room name
        });
    }
  }, [rooms, selfId]);

  const filteredRooms = useMemo(() => {
    // Server returns membership rooms oldest-first; chats sort by the newest
    // message first (then fall back to creation time). ISO strings compare
    // lexicographically in chronological order.
    const sorted = rooms
      .slice()
      .sort((a, b) => {
        const aTime = a.lastMessage?.timestamp ?? a.createdAt;
        const bTime = b.lastMessage?.timestamp ?? b.createdAt;
        return bTime.localeCompare(aTime);
      });
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((room) => room.name.toLowerCase().includes(q));
  }, [rooms, query]);

  const handleRoomPress = (room: Room) => {
    navigation.navigate('Room', { roomId: room.id, roomName: room.name });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen-chats">
      <View style={styles.navbar}>
        <Text style={styles.navTitle} testID="chats-title">
          OPC IM
        </Text>
        <TouchableOpacity
          testID="chats-new-group-btn"
          onPress={() => navigation.navigate('NewGroup')}
          hitSlop={8}>
          <Text style={styles.navAction}>＋</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        testID="chats-search"
        placeholder="🔍 Search chats / agents"
        placeholderTextColor={theme.colors.muted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoadingRooms ? (
        <ActivityIndicator
          style={styles.loader}
          color={theme.colors.accent}
        />
      ) : (
        <FlatList
          data={filteredRooms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            return (
              <ConversationRow
                room={item}
                displayName={directNames[item.id] ?? item.name}
                selfId={selfId}
                onPress={handleRoomPress}
              />
            );
          }}
          contentContainerStyle={styles.list}
          testID="conv-list"
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query
                ? 'No chats match your search'
                : 'No rooms yet — create one on the server'}
            </Text>
          }
        />
      )}
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
  list: {
    paddingBottom: 16,
  },
  conv: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
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
  convMid: {
    flex: 1,
    minWidth: 0,
  },
  convHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  convName: {
    color: theme.colors.text,
    fontSize: 15.5,
    fontWeight: '600',
    flex: 1,
  },
  time: {
    color: theme.colors.muted,
    fontSize: 11.5,
  },
  preview: {
    color: theme.colors.muted,
    fontSize: 13.5,
    marginTop: 3,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.danger,
  },
  unreadBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  error: {
    color: theme.colors.danger,
    marginHorizontal: 14,
    marginBottom: 12,
  },
  loader: {
    marginTop: 24,
  },
  empty: {
    textAlign: 'center',
    color: theme.colors.muted,
    marginTop: 32,
  },
});
