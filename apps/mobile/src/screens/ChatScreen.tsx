import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useRoom } from '../hooks/useRoom';
import type { Message } from '@opc/api-client';

export function ChatScreen(): React.JSX.Element {
  const route = useRoute();
  const { roomId, roomName } = route.params as { roomId: string; roomName: string };
  const { messages, isLoadingMessages, mqttState, enterRoom, leaveRoom, sendText } = useRoom();
  const [text, setText] = useState('');

  useEffect(() => {
    enterRoom(roomId);
    return () => {
      leaveRoom();
    };
  }, [roomId, enterRoom, leaveRoom]);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    sendText(roomId, text.trim());
    setText('');
  }, [text, roomId, sendText]);

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={styles.messageItem}>
      <Text style={styles.messageFrom}>{item.from}</Text>
      <Text style={styles.messageBody}>{item.content.body}</Text>
      <Text style={styles.messageTime}>{new Date(item.createdAt).toLocaleTimeString()}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          MQTT: {mqttState} | 房间: {roomName}
        </Text>
      </View>

      {isLoadingMessages ? (
        <Text style={styles.loading}>加载历史消息中…</Text>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          inverted={false}
        />
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="输入消息…"
          multiline
        />
        <Button title="发送" onPress={handleSend} disabled={!text.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusBar: {
    padding: 8,
    backgroundColor: '#f0f0f0',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  loading: {
    textAlign: 'center',
    marginTop: 24,
    color: '#666',
  },
  messageList: {
    padding: 16,
  },
  messageItem: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  messageFrom: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  messageBody: {
    fontSize: 15,
    lineHeight: 20,
  },
  messageTime: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginRight: 8,
    maxHeight: 100,
  },
});
