import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { createOpcMqttClient } from '../client.js';
import { MQTT_TOPICS } from '../topics.js';

vi.mock('mqtt', () => ({
  default: {
    connect: vi.fn(),
  },
  connect: vi.fn(),
}));

import mqtt from 'mqtt';

function createMockConnection(): EventEmitter & {
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const emitter = new EventEmitter();
  const connection = Object.assign(emitter, {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    end: vi.fn(),
  });
  return connection;
}

describe('createOpcMqttClient', () => {
  beforeEach(() => {
    vi.mocked(mqtt.connect).mockReset();
  });

  it('connects with participant credentials', () => {
    const mock = createMockConnection();
    vi.mocked(mqtt.connect).mockReturnValue(mock as unknown as ReturnType<typeof mqtt.connect>);

    const client = createOpcMqttClient({
      brokerUrl: 'mqtt://localhost:1883',
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });

    client.connect();

    expect(mqtt.connect).toHaveBeenCalledWith(
      'mqtt://localhost:1883',
      expect.objectContaining({
        username: 'alice',
        password: 'secret',
        clientId: 'alice-mobile',
      }),
    );
  });

  it('emits state changes and resubscribes rooms on connect', () => {
    const mock = createMockConnection();
    vi.mocked(mqtt.connect).mockReturnValue(mock as unknown as ReturnType<typeof mqtt.connect>);

    const client = createOpcMqttClient({
      brokerUrl: 'mqtt://localhost:1883',
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });

    const stateChanges: string[] = [];
    client.onStateChange((state) => stateChanges.push(state));

    client.connect();
    client.subscribeRoom('room-1');
    mock.emit('connect');

    expect(stateChanges).toContain('connected');
    expect(mock.subscribe).toHaveBeenCalledWith(
      MQTT_TOPICS.events('room-1'),
      expect.objectContaining({ qos: 1 }),
    );
  });

  it('publishes uplink payload when connected', () => {
    const mock = createMockConnection();
    vi.mocked(mqtt.connect).mockReturnValue(mock as unknown as ReturnType<typeof mqtt.connect>);

    const client = createOpcMqttClient({
      brokerUrl: 'mqtt://localhost:1883',
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });

    client.connect();
    mock.emit('connect');
    client.sendUplink('room-1', {
      from: 'alice',
      content: { type: 'text', body: 'hello' },
      clientMessageId: 'msg-1',
    });

    expect(mock.publish).toHaveBeenCalledWith(
      MQTT_TOPICS.uplink('room-1'),
      JSON.stringify({
        from: 'alice',
        content: { type: 'text', body: 'hello' },
        clientMessageId: 'msg-1',
      }),
      expect.objectContaining({ qos: 1 }),
    );
  });

  it('emits parsed server events', () => {
    const mock = createMockConnection();
    vi.mocked(mqtt.connect).mockReturnValue(mock as unknown as ReturnType<typeof mqtt.connect>);

    const client = createOpcMqttClient({
      brokerUrl: 'mqtt://localhost:1883',
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });

    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));

    client.connect();
    mock.emit('connect');

    const deliveredEvent = {
      type: 'message.delivered',
      message: {
        id: 'm-1',
        roomId: 'room-1',
        from: 'alice',
        content: { type: 'text', body: 'hello' },
        createdAt: '2026-07-15T00:00:00.000Z',
      },
    };
    mock.emit('message', MQTT_TOPICS.events('room-1'), Buffer.from(JSON.stringify(deliveredEvent)));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(deliveredEvent);
  });
});
