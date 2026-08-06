import { describe, expect, it } from 'vitest';
import { GatewayModelCatalogSchema } from '@logact-pub/opc-protocol';
import {
  createAuthenticatedHttpClient,
  createHttpClient,
  startTestServer,
} from './helpers.js';

/**
 * E2E: gateway 模型目录（modelCatalog）的上报与读取。
 *
 * 目标行为（spec #70）：
 * - `PATCH /api/v1/participants/{id}` 接受 `modelCatalog`，持久化到 participant
 *   的 `metadata.modelCatalog`；
 * - `GET /participants/{id}` 与 `GET /participants?kind=gateway` 原样带回；
 * - 不合法的 catalog 负载被拒绝（400）。
 *
 * 全部请求通过 @logact-pub/opc-sdk 的 OpcHttpClient 驱动（e2e 约定）。
 */

const CATALOG = {
  providers: [
    {
      provider: 'moonshotai',
      models: [
        {
          id: 'kimi-k2-0905-preview',
          name: 'Kimi K2 0905 Preview',
          reasoning: true,
          contextWindow: 262144,
          maxTokens: 16384,
        },
        { id: 'kimi-coding', name: 'Kimi for Coding' },
      ],
    },
    {
      provider: 'anthropic',
      models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
    },
  ],
  updatedAt: '2026-07-29T00:00:00.000Z',
} as const;

describe('Gateway model catalog E2E', () => {
  it('persists modelCatalog via PATCH and returns it from get/list', async () => {
    const { cleanup } = await startTestServer();
    try {
      const http = await createAuthenticatedHttpClient();
      const gatewayId = `gw-catalog-${Date.now()}`;
      const { token } = await http.registerParticipant(
        gatewayId,
        'Catalog Gateway',
        undefined,
        'gateway'
      );
      // gateway 无 staff position（#115），无法经 position 获得 capability
      // grant；server 放行 gateway 自读/自改自身记录（spec #70 自管理场景）
      // PATCH 需要 Bearer 凭证；gateway 持有的 participant token 即可（与 MQTT 同一凭据）
      const gatewayHttp = createHttpClient();
      gatewayHttp.setAccessToken(token);

      await gatewayHttp.updateParticipant(gatewayId, {
        modelCatalog: CATALOG,
      } as Parameters<typeof gatewayHttp.updateParticipant>[1]);

      // GET /participants/{id} 带回 metadata.modelCatalog
      const { participant } = await gatewayHttp.getParticipant(gatewayId);
      expect(participant.metadata?.modelCatalog).toEqual(CATALOG);
      // 形状符合 protocol 契约
      expect(() => GatewayModelCatalogSchema.parse(participant.metadata?.modelCatalog)).not.toThrow();

      // GET /participants?kind=gateway 同样带回
      const { participants } = await gatewayHttp.listParticipants('gateway');
      const listed = participants.find((p) => p.id === gatewayId);
      expect(listed).toBeDefined();
      expect(listed?.metadata?.modelCatalog).toEqual(CATALOG);
    } finally {
      await cleanup();
    }
  });

  it('rejects an invalid modelCatalog payload with 400', async () => {
    const { cleanup } = await startTestServer();
    try {
      const http = await createAuthenticatedHttpClient();
      const gatewayId = `gw-catalog-bad-${Date.now()}`;
      const { token } = await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
      http.setAccessToken(token);

      const invalid = {
        modelCatalog: {
          // models[].id 缺失；providers[].provider 为空对象
          providers: [{ models: [{ name: 'missing id' }] }],
          updatedAt: 12345,
        },
      };

      await expect(
        http.updateParticipant(
          gatewayId,
          invalid as unknown as Parameters<typeof http.updateParticipant>[1]
        )
      ).rejects.toThrow(/400/);
    } finally {
      await cleanup();
    }
  });
});
