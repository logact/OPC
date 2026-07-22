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
  // Ref for synchronous disposal; state for the published value. Reading a
  // ref inside useMemo would publish a stale client when a second connect
  // runs before the next state change.
  const clientRef = useRef<OpcMqttClient | null>(null);
  const [client, setClient] = useState<OpcMqttClient | null>(null);
  const handleServerEvent = useRoomStore((s) => s.handleServerEvent);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setClient(null);
  }, []);

  const connect = useCallback(
    (participantId: string, token: string, clientId: string) => {
      disconnect();

      const next = createOpcMqttClient({
        brokerUrl: ENV.mqttBrokerUrl,
        participantId,
        token,
        clientId,
      });

      next.onStateChange(setState);
      next.onError(setError);
      next.onEvent(handleServerEvent);

      next.connect();
      clientRef.current = next;
      setClient(next);
    },
    [disconnect, handleServerEvent],
  );

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const value = useMemo(
    () => ({ client, state, error, connect, disconnect }),
    [client, state, error, connect, disconnect],
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
