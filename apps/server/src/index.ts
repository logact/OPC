import type { GatewayCommand, ServerEvent } from '@logact-pub/opc-protocol';
import { createServer } from './server.js';
import { createMqttBridge } from './mqtt-bridge.js';
import { bootstrapFirstOwner } from './bootstrap.js';
import {
  createDbClient,
  createMessageRepository,
  createOrganizationRepository,
  createParticipantRepository,
  createRoomRepository,
} from '@opc/database';

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/opc';
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
const MQTT_SERVER_USERNAME = process.env.MQTT_SERVER_USERNAME ?? '__server__';
const MQTT_SERVER_PASSWORD = process.env.MQTT_SERVER_PASSWORD ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
const ALLOW_OPEN_BOOTSTRAP = process.env.OPC_ALLOW_OPEN_BOOTSTRAP === 'true';

if (!MQTT_SERVER_PASSWORD) {
  console.error('MQTT_SERVER_PASSWORD is required (broker superuser credential)');
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

const db = createDbClient(DATABASE_URL);
const participantRepo = createParticipantRepository(db);
const organizationRepo = createOrganizationRepository(db);
const eventPublisher: {
  publish?: (roomId: string, event: ServerEvent) => void;
  publishGatewayCommand?: (gatewayId: string, command: GatewayCommand) => void;
} = {};
const server = createServer({
  db,
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: JWT_EXPIRES_IN,
  mqttSuperuser: { username: MQTT_SERVER_USERNAME, password: MQTT_SERVER_PASSWORD },
  eventPublisher: {
    publish: (roomId, event) => eventPublisher.publish?.(roomId, event),
    publishGatewayCommand: (gatewayId, command) => eventPublisher.publishGatewayCommand?.(gatewayId, command),
  },
  allowOpenBootstrap: ALLOW_OPEN_BOOTSTRAP,
});

const bridge = createMqttBridge({
  brokerUrl: MQTT_BROKER_URL,
  username: MQTT_SERVER_USERNAME,
  password: MQTT_SERVER_PASSWORD,
  participantRepo,
  roomRepo: createRoomRepository(db),
  messageRepo: createMessageRepository(db),
});

bridge.ready
  .then(() => {
    eventPublisher.publish = (roomId, event) => bridge.publish(roomId, event);
    eventPublisher.publishGatewayCommand = (gatewayId, command) => bridge.publishGatewayCommand(gatewayId, command);
    console.log(`MQTT bridge connected to ${MQTT_BROKER_URL}`);
  })
  .catch((err: unknown) => {
    console.error('MQTT bridge failed to subscribe:', err);
  });

// issue #122：监听前从 env 种子首个 owner；配置错误（只设一个变量）时 fail fast
bootstrapFirstOwner({ participantRepo, organizationRepo })
  .then(() => {
    server.listen(PORT, () => {
      console.log(`OPC server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err: unknown) => {
    console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
