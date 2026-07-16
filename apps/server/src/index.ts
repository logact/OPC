import type { ServerEvent } from '@logact-pub/opc-protocol';
import { createServer } from './server.js';
import { createMqttBridge } from './mqtt-bridge.js';
import {
  createDbClient,
  createMessageRepository,
  createParticipantRepository,
  createRoomRepository,
} from '@opc/database';

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/opc';
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
const MQTT_SERVER_USERNAME = process.env.MQTT_SERVER_USERNAME ?? '__server__';
const MQTT_SERVER_PASSWORD = process.env.MQTT_SERVER_PASSWORD ?? '';

if (!MQTT_SERVER_PASSWORD) {
  console.error('MQTT_SERVER_PASSWORD is required (broker superuser credential)');
  process.exit(1);
}

const db = createDbClient(DATABASE_URL);
const eventPublisher: { publish?: (roomId: string, event: ServerEvent) => void } = {};
const server = createServer({
  db,
  mqttSuperuser: { username: MQTT_SERVER_USERNAME, password: MQTT_SERVER_PASSWORD },
  eventPublisher: {
    publish: (roomId, event) => eventPublisher.publish?.(roomId, event),
  },
});

const bridge = createMqttBridge({
  brokerUrl: MQTT_BROKER_URL,
  username: MQTT_SERVER_USERNAME,
  password: MQTT_SERVER_PASSWORD,
  participantRepo: createParticipantRepository(db),
  roomRepo: createRoomRepository(db),
  messageRepo: createMessageRepository(db),
});

bridge.ready
  .then(() => {
    eventPublisher.publish = (roomId, event) => bridge.publish(roomId, event);
    console.log(`MQTT bridge connected to ${MQTT_BROKER_URL}`);
  })
  .catch((err: unknown) => {
    console.error('MQTT bridge failed to subscribe:', err);
  });

server.listen(PORT, () => {
  console.log(`OPC server listening on http://localhost:${PORT}`);
});
