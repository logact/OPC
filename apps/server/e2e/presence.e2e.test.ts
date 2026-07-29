import { describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import mqtt, { type MqttClient } from 'mqtt';
import { MQTT_TOPICS } from '@logact-pub/opc-protocol';
import {
  connectSdkClient,
  createHttpClient,
  registerParticipant,
  startTestServer,
  TEST_MQTT,
} from './helpers.js';

/**
 * Presence（participant/gateway 在线状态）e2e。
 * 实时面以 @logact-pub/opc-sdk 的 OpcClient 为入口；ACL 负向用例需要
 * 伪造他人 presence topic 的 PUBLISH，SDK 不提供该能力，故该用例使用
 * 原始 mqtt.js（与 contract.test.ts 的 wire 级定位一致）。
 *
 * 在线状态语义（issue #72 align spec）：
 * - 客户端 CONNECT 时注册 LWT：retained {online:false} 到自己的 presence topic；
 * - connect 后发布 retained {online:true}；优雅 disconnect 前先发布 offline；
 * - server 订阅 opc/participants/+/presence，收到消息后以服务器时间更新
 *   DB 的 online / lastSeen，并随 Participant 响应带出 presence 字段。
 */

const POLL_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 200;

/** 轮询直到条件满足（go-auth 回调与 retained 回放都有额外延迟） */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before timeout');
    await sleep(POLL_INTERVAL_MS);
  }
}

async function waitForOnline(http: ReturnType<typeof createHttpClient>, id: string): Promise<void> {
  await waitFor(async () => {
    const { participant } = await http.getParticipant(id);
    return participant.presence?.online === true;
  });
}

async function waitForOffline(
  http: ReturnType<typeof createHttpClient>,
  id: string
): Promise<void> {
  await waitFor(async () => {
    const { participant } = await http.getParticipant(id);
    return participant.presence?.online === false;
  });
}

describe('Presence E2E (issue #72)', () => {
  it('marks participant online after MQTT connect', async () => {
    const { cleanup } = await startTestServer();

    try {
      const id = 'presence-connect';
      const token = await registerParticipant(id);
      const http = createHttpClient();
      http.setAccessToken(token);

      const client = await connectSdkClient(id, token);
      try {
        await waitForOnline(http, id);

        const { participant } = await http.getParticipant(id);
        expect(participant.presence?.online).toBe(true);
        expect(participant.presence?.lastSeen).toBeTruthy();
      } finally {
        await client.disconnect();
      }
    } finally {
      await cleanup();
    }
  });

  it('marks participant offline via LWT after an abrupt disconnect', async () => {
    const { cleanup } = await startTestServer();

    try {
      const id = 'presence-lwt';
      const token = await registerParticipant(id);
      const http = createHttpClient();
      http.setAccessToken(token);

      const client = await connectSdkClient(id, token);
      await waitForOnline(http, id);

      // 模拟异常断线：直接销毁底层 socket（不发 DISCONNECT 包），
      // broker 检测到连接关闭后应立即发布该客户端的 LWT。
      const raw = (client as unknown as { mqtt?: MqttClient }).mqtt;
      expect(raw).toBeDefined();
      raw!.stream.destroy();

      await waitForOffline(http, id);

      const { participant } = await http.getParticipant(id);
      expect(participant.presence?.online).toBe(false);
      // lastSeen 由 server 打时间戳，应接近断线时刻而非 LWT 注册时刻
      const lastSeenMs = new Date(participant.presence!.lastSeen).getTime();
      expect(Number.isNaN(lastSeenMs)).toBe(false);
      expect(Math.abs(Date.now() - lastSeenMs)).toBeLessThan(30_000);
    } finally {
      await cleanup();
    }
  });

  it('marks participant offline on graceful disconnect', async () => {
    const { cleanup } = await startTestServer();

    try {
      const id = 'presence-graceful';
      const token = await registerParticipant(id);
      const http = createHttpClient();
      http.setAccessToken(token);

      const client = await connectSdkClient(id, token);
      await waitForOnline(http, id);

      // 优雅断开：SDK 先发布 retained offline 再关闭连接
      await client.disconnect();

      await waitForOffline(http, id);
    } finally {
      await cleanup();
    }
  });

  it('enforces presence topic ACL: read for all, write only for self', async () => {
    const { cleanup } = await startTestServer();

    let attacker: MqttClient | undefined;
    try {
      const idA = 'presence-alice';
      const idB = 'presence-bob';
      const tokenA = await registerParticipant(idA);
      const tokenB = await registerParticipant(idB);
      const httpB = createHttpClient();
      httpB.setAccessToken(tokenB);

      // B 通过 SDK 上线，发布 retained online presence
      const clientB = await connectSdkClient(idB, tokenB);
      try {
        await waitForOnline(httpB, idB);

        // A 以原始 mqtt.js 连接（需要伪造 B 的 presence topic，超出 SDK 能力）
        attacker = mqtt.connect(TEST_MQTT.brokerUrl, {
          username: idA,
          password: tokenA,
          reconnectPeriod: 0,
        });
        await new Promise<void>((resolve, reject) => {
          attacker!.once('connect', () => resolve());
          attacker!.once('error', reject);
        });

        // 正向：任何已认证 participant 都可订阅 presence 通配 topic，
        // 订阅后收到 B 的 retained online 消息（共享 broker 上有其他测试
        // 遗留的 retained presence，需按 topic 过滤等待 B 的那条）
        const bobPresence = new Promise<Buffer>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('timed out waiting for bob retained presence')),
            POLL_TIMEOUT_MS
          );
          attacker!.on('message', (topic, payload) => {
            if (topic === MQTT_TOPICS.presence(idB)) {
              clearTimeout(timer);
              resolve(payload);
            }
          });
        });
        const granted = await new Promise<mqtt.ISubscriptionGrant[]>((resolve, reject) => {
          attacker!.subscribe(
            MQTT_TOPICS.presenceFilter,
            { qos: 1 },
            (err, grants) => (err ? reject(err) : resolve(grants ?? []))
          );
        });
        expect(granted.map((g) => g.qos)).not.toContain(128);

        expect(JSON.parse((await bobPresence).toString('utf8'))).toMatchObject({ online: true });

        // 负向：A 向 B 的 presence topic 伪造 retained offline，broker 应拒绝，
        // server 侧 B 的状态保持不变
        attacker.publish(MQTT_TOPICS.presence(idB), JSON.stringify({ online: false }), {
          qos: 1,
          retain: true,
        });
        await sleep(1500);

        const { participant } = await httpB.getParticipant(idB);
        expect(participant.presence?.online).toBe(true);
      } finally {
        await clientB.disconnect();
      }
    } finally {
      if (attacker) {
        await new Promise<void>((resolve) => attacker!.end(true, {}, () => resolve()));
      }
      await cleanup();
    }
  });

  it('keeps presence readable and correct across a server restart', async () => {
    // 注意：go-auth 架构下 server 下线期间 broker 状态不可能改变（auth/ACL/LWT
    // 回调全部指向 server HTTP endpoint，fail-closed），而重启后 bridge 重订阅的
    // retained 回放与客户端实时状态切换之间存在时序竞争，无法在 e2e 中稳定构造
    // “回放纠正过期状态”的断言。这里验证可稳定成立的部分：客户端保持连接穿过
    // server 重启后，presence 状态仍可读取且正确。
    let server = await startTestServer();
    const id = 'presence-restart';
    const token = await registerParticipant(id);
    const http = createHttpClient();
    http.setAccessToken(token);

    const client = await connectSdkClient(id, token);
    await waitForOnline(http, id);

    // server 重启（客户端保持连接）
    await server.cleanup();
    server = await startTestServer();

    try {
      const { participant } = await http.getParticipant(id);
      expect(participant.presence?.online).toBe(true);
    } finally {
      await client.disconnect();
      await server.cleanup();
    }
  });
});
