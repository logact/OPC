import { useCallback, useEffect } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAuth } from './useAuth';
import { useMqtt } from '../contexts/MqttContext';
import type { UplinkPayload } from '@opc/mqtt-client';
import type { MessageIntent } from '@logact-pub/opc-protocol';

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
    (roomId: string, text: string, intent?: MessageIntent) => {
      console.log(`[useRoom] before sendText: roomId=${roomId}, text=${text}`);
      if (!participantId || !mqtt.client) return;
      console.log(`[useRoom] start sendText: roomId=${roomId},participantId=${participantId}, text=${text}`);

      const payload: UplinkPayload = {
        from: participantId,
        content: { type: 'text', body: text },
        clientMessageId: `${participantId}-${Date.now()}`,
        intent,
      };
      try {
        mqtt.client.sendUplink(roomId, payload);
        console.log(`[useRoom] finish sendText: roomId=${roomId}, text=${text}`);
      } catch (err) {
        // sendUplink 在 publish 前有两道同步守卫（连接状态 / from 匹配），
        // 这里接住并打出 mqtt 状态，避免未捕获异常直接红屏
        console.error(
          `[useRoom] sendUplink threw: ${err instanceof Error ? err.message : String(err)} ` +
            `(client.state=${mqtt.client.state}, client.error=${mqtt.client.error?.message ?? 'none'}, participantId=${participantId})`,
        );
      }
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
