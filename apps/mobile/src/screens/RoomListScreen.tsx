import React, { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Button,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { useRoom } from '../hooks/useRoom';
import type { Room } from '../stores/roomStore';

export function RoomListScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { logout } = useAuth();
  const { rooms, isLoadingRooms, error, loadRooms } = useRoom();

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const handleRoomPress = (room: Room) => {
    navigation.navigate('Chat', { roomId: room.id, roomName: room.name });
  };

  const renderItem = ({ item }: { item: Room }) => (
    <TouchableOpacity
      style={styles.roomItem}
      onPress={() => handleRoomPress(item)}>
      <Text style={styles.roomName}>{item.name}</Text>
      <Text style={styles.roomId}>{item.id}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>房间列表</Text>
        <Button title="退出" onPress={logout} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoadingRooms ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>暂无房间，请在 server 端创建</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  list: {
    paddingBottom: 16,
  },
  roomItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  roomName: {
    fontSize: 16,
    fontWeight: '600',
  },
  roomId: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  error: {
    color: '#d32f2f',
    marginBottom: 12,
  },
  loader: {
    marginTop: 24,
  },
  empty: {
    textAlign: 'center',
    color: '#999',
    marginTop: 32,
  },
});
