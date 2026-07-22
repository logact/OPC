import { useCallback, useEffect } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAuth } from './useAuth';
import { useMqtt } from '../contexts/MqttContext';
import type { UplinkPayload } from '@opc/mqtt-client';

export function useRoom() {
  const { participantId, token, clientId, isLoggedIn } = useAuth();
  const mqtt = useMqtt();
  // connect/disconnect have stable identity; the mqtt context value does not
  // (it changes on every connection-state change). Depending on the whole
  // value made this effect tear down and recreate the connection in a loop.
  const { connect, disconnect } = mqtt;
  // Select slices individually: zustand actions keep stable identity, so
  // effects/callbacks depending on them don't refire on every store change
  // (whole-store subscription made loadRooms loop forever on errors).
  const rooms = useRoomStore((state) => state.rooms);
  const currentRoomId = useRoomStore((state) => state.currentRoomId);
  const messages = useRoomStore((state) => state.messages);
  const lastMessages = useRoomStore((state) => state.lastMessages);
  const isLoadingRooms = useRoomStore((state) => state.isLoadingRooms);
  const isLoadingMessages = useRoomStore((state) => state.isLoadingMessages);
  const error = useRoomStore((state) => state.error);
  const loadRooms = useRoomStore((state) => state.loadRooms);
  const enterRoom = useRoomStore((state) => state.enterRoom);
  const leaveRoom = useRoomStore((state) => state.leaveRoom);

  useEffect(() => {
    if (isLoggedIn && participantId && token && clientId) {
      connect(participantId, token, clientId);
    } else {
      disconnect();
    }
  }, [isLoggedIn, participantId, token, clientId, connect, disconnect]);

  useEffect(() => {
    if (currentRoomId) {
      mqtt.client?.subscribeRoom(currentRoomId);
    }
    return () => {
      if (currentRoomId) {
        mqtt.client?.unsubscribeRoom(currentRoomId);
      }
    };
  }, [currentRoomId, mqtt.client]);

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
    rooms,
    currentRoomId,
    messages,
    lastMessages,
    isLoadingRooms,
    isLoadingMessages,
    error,
    mqttState: mqtt.state,
    loadRooms,
    enterRoom,
    leaveRoom,
    sendText,
  };
}
