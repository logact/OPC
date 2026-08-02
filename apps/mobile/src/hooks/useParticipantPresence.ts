import { useEffect, useState } from 'react';
import type { PresencePayload } from '@logact-pub/opc-protocol';
import { useMqtt } from '../contexts/MqttContext';

export function useParticipantPresence(): Record<string, PresencePayload> {
  const { client } = useMqtt();
  const [presence, setPresence] = useState<Record<string, PresencePayload>>({});

  useEffect(() => {
    return client?.subscribePresence((participantId, next) => {
      setPresence(current => ({ ...current, [participantId]: next }));
    });
  }, [client]);

  return presence;
}
