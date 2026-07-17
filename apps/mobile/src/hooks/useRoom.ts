import { useCallback, useEffect } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAuth } from './useAuth';
import { useMqtt } from '../contexts/MqttContext';
import type { UplinkPayload } from '@opc/mqtt-client';

export function useRoom() {
  const { participantId, token, clientId, isLoggedIn } = useAuth();
  const mqtt = useMqtt();
  const store = useRoomStore();

  useEffect(() => {
    if (isLoggedIn && participantId && token && clientId) {
      mqtt.connect(participantId, token, clientId);
    } else {
      mqtt.disconnect();
    }
  }, [isLoggedIn, participantId, token, clientId, mqtt]);

  useEffect(() => {
    if (store.currentRoomId) {
      mqtt.client?.subscribeRoom(store.currentRoomId);
    }
    return () => {
      if (store.currentRoomId) {
        mqtt.client?.unsubscribeRoom(store.currentRoomId);
      }
    };
  }, [store.currentRoomId, mqtt.client]);

  const loadRooms = useCallback(() => {
    return store.loadRooms();
  }, [store]);

  const enterRoom = useCallback(
    (roomId: string) => {
      return store.enterRoom(roomId);
    },
    [store],
  );

  const leaveRoom = useCallback(() => {
    store.leaveRoom();
  }, [store]);

  const sendText = useCallback(
    (roomId: string, text: string) => {
      if (!participantId || !mqtt.client) return;

      const payload: UplinkPayload = {
        from: participantId,
        content: { type: 'text', body: text },
        clientMessageId: `${participantId}-${Date.now()}`,
      };
      mqtt.client.sendUplink(roomId, payload);
    },
    [participantId, mqtt.client],
  );

  return {
    rooms: store.rooms,
    currentRoomId: store.currentRoomId,
    messages: store.messages,
    isLoadingRooms: store.isLoadingRooms,
    isLoadingMessages: store.isLoadingMessages,
    error: store.error,
    mqttState: mqtt.state,
    loadRooms,
    enterRoom,
    leaveRoom,
    sendText,
  };
}
