import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createOpcMqttClient,
  type MqttConnectionState,
  type OpcMqttClient,
} from '@opc/mqtt-client';
import { ENV } from '../config/env';
import { useRoomStore } from '../stores/roomStore';

interface MqttContextValue {
  client: OpcMqttClient | null;
  state: MqttConnectionState;
  error: Error | null;
  connect: (participantId: string, token: string, clientId: string) => void;
  disconnect: () => void;
}

const MqttContext = createContext<MqttContextValue | null>(null);

export function MqttProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MqttConnectionState>('disconnected');
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<OpcMqttClient | null>(null);
  const handleServerEvent = useRoomStore((s) => s.handleServerEvent);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
  }, []);

  const connect = useCallback(
    (participantId: string, token: string, clientId: string) => {
      disconnect();

      const client = createOpcMqttClient({
        brokerUrl: ENV.mqttBrokerUrl,
        participantId,
        token,
        clientId,
      });

      client.onStateChange(setState);
      client.onError(setError);
      client.onEvent(handleServerEvent);

      client.connect();
      clientRef.current = client;
    },
    [disconnect, handleServerEvent],
  );

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const value = useMemo(
    () => ({
      client: clientRef.current,
      state,
      error,
      connect,
      disconnect,
    }),
    [state, error, connect, disconnect],
  );

  return <MqttContext.Provider value={value}>{children}</MqttContext.Provider>;
}

export function useMqtt(): MqttContextValue {
  const context = useContext(MqttContext);
  if (!context) {
    throw new Error('useMqtt must be used within a MqttProvider');
  }
  return context;
}
