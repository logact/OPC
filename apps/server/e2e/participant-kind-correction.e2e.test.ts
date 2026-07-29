import { describe, expect, it } from 'vitest';
import { createAuthenticatedHttpClient, createHttpClient, startTestServer } from './helpers.js';

/**
 * Issue #69：gateway participant 被落库为 human 后无法通过重新注册纠正，
 * 在 mobile Contacts 中出现在 Humans 分组。
 *
 * 覆盖的契约：
 * 1. 重复注册同一 id 时，显式传入的 kind 必须纠正已落库的 kind
 *    （至少允许 human → gateway/agent 的升级）。
 * 2. 已落库的 gateway/agent 不得被缺省 kind（human）的重复注册降级。
 *
 * 管理面通过 @logact-pub/opc-sdk 驱动，与 mobile 实际消费路径一致。
 */

describe('Participant kind correction on re-registration (issue #69)', () => {
  it('corrects a human row created by room membership when re-registered as gateway', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = await createAuthenticatedHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-fix-${suffix}`;

      // 复现路径 2：gateway 先经房间创建被 ensure() 自动落库（默认 kind = human）
      await http.createRoom({ name: `room-${suffix}`, participantIds: [gatewayId] });
      const before = await http.listParticipants();
      expect(before.participants.some((p) => p.id === gatewayId && p.kind === 'human')).toBe(
        true
      );

      // 修复：重新注册时显式传 kind 必须纠正落库的 kind
      await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');

      const gateways = await http.listParticipants('gateway');
      expect(gateways.participants.some((p) => p.id === gatewayId)).toBe(true);

      // 不再出现在 humans 分组
      const humans = await http.listParticipants('human');
      expect(humans.participants.some((p) => p.id === gatewayId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('corrects a default-kind (human) registration when re-registered as gateway', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-reg-${suffix}`;

      // 复现路径 1：注册时未显式传 kind，落库为 human（如手动 POST 或旧版本 edge app）
      await http.registerParticipant(gatewayId);
      const before = await http.listParticipants();
      expect(before.participants.some((p) => p.id === gatewayId && p.kind === 'human')).toBe(
        true
      );

      // 修复：显式 kind 的重复注册纠正为 gateway
      await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
      const gateways = await http.listParticipants('gateway');
      expect(gateways.participants.some((p) => p.id === gatewayId)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('does not downgrade a gateway back to human on a default-kind re-registration', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-nodown-${suffix}`;

      await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');

      // token 轮换等场景会用缺省 kind 重新注册，不得把 gateway 降回 human
      await http.registerParticipant(gatewayId);

      const gateways = await http.listParticipants('gateway');
      expect(gateways.participants.some((p) => p.id === gatewayId)).toBe(true);
      const humans = await http.listParticipants('human');
      expect(humans.participants.some((p) => p.id === gatewayId)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
