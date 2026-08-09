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
        clean: false,
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

  it('reconciles all room subscriptions in batches', () => {
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

    client.subscribeRooms(['room-1', 'room-2']);
    expect(mock.subscribe).toHaveBeenCalledWith(
      [MQTT_TOPICS.events('room-1'), MQTT_TOPICS.events('room-2')],
      expect.objectContaining({ qos: 1 }),
    );

    client.subscribeRooms(['room-2', 'room-3']);
    expect(mock.unsubscribe).toHaveBeenCalledWith([MQTT_TOPICS.events('room-1')]);
    expect(mock.subscribe).toHaveBeenCalledWith(
      [MQTT_TOPICS.events('room-3')],
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
      MQTT_TOPICS.participantUplink('alice', 'room-1'),
      JSON.stringify({
        content: { type: 'text', body: 'hello' },
        clientMessageId: 'msg-1',
      }),
      expect.objectContaining({ qos: 1 }),
      expect.any(Function),
    );
  });

  it('publishes a read receipt when connected', () => {
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
    client.publishReadReceipt('room-1', 'alice', '2026-08-05T12:00:00.000Z');

    expect(mock.publish).toHaveBeenCalledWith(
      MQTT_TOPICS.participantReads('alice', 'room-1'),
      JSON.stringify({ from: 'alice', lastReadAt: '2026-08-05T12:00:00.000Z' }),
      expect.objectContaining({ qos: 1 }),
      expect.any(Function),
    );
  });

  it('rejects a read receipt with a non-ISO lastReadAt', () => {
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

    expect(() => client.publishReadReceipt('room-1', 'alice', 'not-a-date')).toThrow();
    expect(mock.publish).not.toHaveBeenCalledWith(
      MQTT_TOPICS.participantReads('alice', 'room-1'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits parsed server events', () => {    const mock = createMockConnection();
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

  it('registers an LWT and publishes retained online on connect', () => {
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
        will: {
          topic: 'opc/participants/alice/presence',
          payload: JSON.stringify({ online: false }),
          qos: 1,
          retain: true,
        },
      }),
    );

    mock.emit('connect');
    expect(mock.publish).toHaveBeenCalledWith(
      'opc/participants/alice/presence',
      JSON.stringify({ online: true }),
      expect.objectContaining({ qos: 1, retain: true }),
    );
  });

  it('publishes retained offline before ending on graceful disconnect', () => {
    const mock = createMockConnection();
    Object.assign(mock, { connected: true });
    vi.mocked(mqtt.connect).mockReturnValue(mock as unknown as ReturnType<typeof mqtt.connect>);

    const client = createOpcMqttClient({
      brokerUrl: 'mqtt://localhost:1883',
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });

    client.connect();
    mock.emit('connect');
    client.disconnect();

    expect(mock.publish).toHaveBeenCalledWith(
      'opc/participants/alice/presence',
      JSON.stringify({ online: false }),
      expect.objectContaining({ qos: 1, retain: true }),
      expect.any(Function),
    );
    // publish 回调未被 mock 触发时不应提前 end
    expect(mock.end).not.toHaveBeenCalled();
  });

  it('routes presence messages to subscribePresence listeners', () => {
    const mock = createMockConnection();
    vi.mocked(mqtt.connect).mockReturnValue(mock as unknown as ReturnType<typeof mqtt.connect>);

    const client = createOpcMqttClient({
      brokerUrl: 'mqtt://localhost:1883',
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });

    const received: Array<{ id: string; online: boolean }> = [];
    client.subscribePresence((id, presence) => received.push({ id, online: presence.online }));

    client.connect();
    mock.emit('connect');

    expect(mock.subscribe).toHaveBeenCalledWith(
      'opc/participants/+/presence',
      expect.objectContaining({ qos: 1 }),
    );

    mock.emit(
      'message',
      'opc/participants/bob/presence',
      Buffer.from(JSON.stringify({ online: true })),
    );
    mock.emit('message', 'opc/participants/bob/presence', Buffer.from('not json'));

    expect(received).toEqual([{ id: 'bob', online: true }]);
  });
});
