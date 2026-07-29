import { describe, expect, it } from 'vitest';
import { createHttpClient, startTestServer } from './helpers.js';

/**
 * Issue #73：server 持久化 agent 的 gatewayId，agent 可按 gateway 归属区分。
 *
 * 覆盖的验收标准：
 * 1. 注册 agent（带 gatewayId）后，getParticipant / listParticipants 返回的
 *    participant 携带 gatewayId。
 * 2. listParticipants 支持 ?gatewayId= 过滤，且可与 ?kind=agent 组合。
 * 3. 重复注册同一 agent 到新 gatewayId 时换绑生效（upsert 更新归属）。
 * 4. human / gateway 注册时携带 gatewayId 不落库、不出现在响应中。
 * 5. 不带 gatewayId 注册的 agent 响应中无 gatewayId 字段（向后兼容）。
 *
 * 管理面通过 @logact-pub/opc-sdk 驱动（SDK: registerParticipant 已支持
 * gatewayId 参数；listParticipants 新增第二参数 gatewayId 过滤）。
 */
describe('Agent gateway ownership (issue #73)', () => {
  it('persists gatewayId on agent registration and returns it in get/list', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-own-${suffix}`;
      const agentId = `agent-own-${suffix}`;

      await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
      await http.registerParticipant(agentId, `Agent ${suffix}`, undefined, 'agent', gatewayId);

      const { participant } = await http.getParticipant(agentId);
      expect(participant.kind).toBe('agent');
      expect(participant.gatewayId).toBe(gatewayId);

      const agents = await http.listParticipants('agent');
      const listed = agents.participants.find((p) => p.id === agentId);
      expect(listed?.gatewayId).toBe(gatewayId);
    } finally {
      await cleanup();
    }
  });

  it('filters participants by gatewayId, composable with the kind filter', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gwA = `gw-fa-${suffix}`;
      const gwB = `gw-fb-${suffix}`;
      const agentA1 = `agent-fa1-${suffix}`;
      const agentA2 = `agent-fa2-${suffix}`;
      const agentB1 = `agent-fb1-${suffix}`;
      const humanId = `human-f-${suffix}`;

      await http.registerParticipant(gwA, undefined, undefined, 'gateway');
      await http.registerParticipant(gwB, undefined, undefined, 'gateway');
      await http.registerParticipant(agentA1, undefined, undefined, 'agent', gwA);
      await http.registerParticipant(agentA2, undefined, undefined, 'agent', gwA);
      await http.registerParticipant(agentB1, undefined, undefined, 'agent', gwB);
      await http.registerParticipant(humanId);

      // ?gatewayId=gwA 只返回 gwA 的 agent
      const ofGwA = await http.listParticipants(undefined, gwA);
      const idsA = ofGwA.participants.map((p) => p.id);
      expect(idsA).toContain(agentA1);
      expect(idsA).toContain(agentA2);
      expect(idsA).not.toContain(agentB1);
      expect(idsA).not.toContain(humanId);
      expect(ofGwA.participants.every((p) => p.gatewayId === gwA)).toBe(true);

      // ?kind=agent&gatewayId=gwB 组合过滤
      const agentsOfGwB = await http.listParticipants('agent', gwB);
      const idsB = agentsOfGwB.participants.map((p) => p.id);
      expect(idsB).toContain(agentB1);
      expect(idsB).not.toContain(agentA1);
      expect(idsB).not.toContain(agentA2);
    } finally {
      await cleanup();
    }
  });

  it('rebinding an agent to a new gateway on re-registration', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gwOld = `gw-old-${suffix}`;
      const gwNew = `gw-new-${suffix}`;
      const agentId = `agent-rebind-${suffix}`;

      await http.registerParticipant(gwOld, undefined, undefined, 'gateway');
      await http.registerParticipant(gwNew, undefined, undefined, 'gateway');
      await http.registerParticipant(agentId, undefined, undefined, 'agent', gwOld);

      const before = await http.getParticipant(agentId);
      expect(before.participant.gatewayId).toBe(gwOld);

      // 重复注册（token 轮换）换绑到新 gateway
      await http.registerParticipant(agentId, undefined, undefined, 'agent', gwNew);

      const after = await http.getParticipant(agentId);
      expect(after.participant.gatewayId).toBe(gwNew);

      const ofOld = await http.listParticipants(undefined, gwOld);
      expect(ofOld.participants.some((p) => p.id === agentId)).toBe(false);
      const ofNew = await http.listParticipants(undefined, gwNew);
      expect(ofNew.participants.some((p) => p.id === agentId)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('ignores gatewayId for non-agent kinds', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-non-${suffix}`;
      const humanId = `human-non-${suffix}`;
      const otherGw = `gw-non2-${suffix}`;

      await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
      // human / gateway 注册时携带 gatewayId：不落库
      await http.registerParticipant(humanId, undefined, undefined, 'human', gatewayId);
      await http.registerParticipant(otherGw, undefined, undefined, 'gateway', gatewayId);

      const human = await http.getParticipant(humanId);
      expect(human.participant.gatewayId).toBeUndefined();
      const gw = await http.getParticipant(otherGw);
      expect(gw.participant.gatewayId).toBeUndefined();

      // gatewayId 过滤不返回非 agent participant
      const ofGw = await http.listParticipants(undefined, gatewayId);
      expect(ofGw.participants.some((p) => p.id === humanId)).toBe(false);
      expect(ofGw.participants.some((p) => p.id === otherGw)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('omits gatewayId for agents registered without one (backward compat)', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const agentId = `agent-nogw-${suffix}`;

      // 与 issue #60 相同的注册方式：不带 gatewayId
      await http.registerParticipant(agentId, undefined, undefined, 'agent');

      const { participant } = await http.getParticipant(agentId);
      expect(participant.kind).toBe('agent');
      expect(participant.gatewayId).toBeUndefined();
      expect('gatewayId' in participant).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
