import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { useRoom } from '../hooks/useRoom';
import { participantsApi } from '../api/http';
import { useAuthStore } from '../stores/authStore';
import { theme } from '../theme';
import { avatarColor } from '../utils/avatar';
import type { Room } from '../stores/roomStore';

// The list-rooms wire payload carries full Room objects (protocol RoomSchema);
// the store's view type narrows to { id, name }.
type RoomListEntry = Room & {
  metadata?: Record<string, unknown> | null;
  participantIds?: string[];
};

function ConversationRow({
  room,
  displayName,
  onPress,
}: {
  room: Room;
  displayName: string;
  onPress: (room: Room) => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.conv}
      testID={`conv-item-${room.id}`}
      onPress={() => onPress(room)}>
      <View
        style={[styles.avatar, { backgroundColor: avatarColor(room.id) }]}
        testID={`conv-avatar-${room.id}`}>
        <Text style={styles.avatarText}>
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.convMid}>
        <Text
          style={styles.convName}
          numberOfLines={1}
          testID={`conv-name-${room.id}`}>
          {displayName}
        </Text>
      </View>
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

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // Direct rooms are named `${participantA}-${participantB}` by the server;
  // resolve the other participant's name once per room and fall back to the
  // raw room name on any failure.
  useEffect(() => {
    for (const room of rooms as RoomListEntry[]) {
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
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((room) => room.name.toLowerCase().includes(q));
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
          renderItem={({ item }) => (
            <ConversationRow
              room={item}
              displayName={directNames[item.id] ?? item.name}
              onPress={handleRoomPress}
            />
          )}
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
  convName: {
    color: theme.colors.text,
    fontSize: 15.5,
    fontWeight: '600',
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
