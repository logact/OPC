import { describe, expect, it } from 'vitest';
import { GatewayModelCatalogSchema } from '@logact-pub/opc-protocol';
import { buildModelCatalog } from './model-catalog.js';

/**
 * buildModelCatalog：pi-ai 内建模型目录 → GatewayModelCatalog 的纯映射。
 *
 * 目标行为（spec #70）：
 * - 按 provider 分组；
 * - 每个模型映射 { id, name, reasoning?, contextWindow?, maxTokens? }；
 * - updatedAt 为 ISO 时间字符串；
 * - 输出通过 protocol 的 GatewayModelCatalogSchema 校验。
 *
 * 注意：agent-gateway 当前不直接依赖 pi-ai，测试以结构类型 stub
 * Models/Model，不 import pi-ai 类型。
 */

/** pi-ai Model 中与 catalog 相关的字段子集（结构类型） */
interface FakeModel {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

function fakeModel(overrides: { id: string; provider: string } & Partial<FakeModel>): FakeModel {
  return {
    name: overrides.id,
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 8192,
    ...overrides,
  };
}

/** 结构 stub pi-ai 的 Models.getModels() 枚举接口 */
function stubModels(models: FakeModel[]): { getModels(provider?: string): FakeModel[] } {
  return {
    getModels: (provider?: string) =>
      provider ? models.filter((m) => m.provider === provider) : models,
  };
}

/** GatewayModelCatalog 的结构镜像（protocol 类型落地前的本地注解，避免 any 噪音） */
interface CatalogShape {
  providers: { provider: string; models: FakeModel[] }[];
  updatedAt: string;
}

describe('buildModelCatalog', () => {
  it('groups models by provider and maps the catalog fields', () => {
    const models = stubModels([
      fakeModel({
        id: 'kimi-k2-0905-preview',
        name: 'Kimi K2 0905 Preview',
        provider: 'moonshotai',
        reasoning: true,
        contextWindow: 262144,
        maxTokens: 16384,
      }),
      fakeModel({ id: 'kimi-coding', name: 'Kimi for Coding', provider: 'moonshotai' }),
      fakeModel({ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' }),
    ]);

    const catalog = buildModelCatalog(models) as CatalogShape;

    expect(catalog.providers).toHaveLength(2);
    const moonshot = catalog.providers.find((p) => p.provider === 'moonshotai');
    expect(moonshot?.models).toEqual([
      {
        id: 'kimi-k2-0905-preview',
        name: 'Kimi K2 0905 Preview',
        reasoning: true,
        contextWindow: 262144,
        maxTokens: 16384,
      },
      {
        id: 'kimi-coding',
        name: 'Kimi for Coding',
        reasoning: false,
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ]);
    const anthropic = catalog.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.models.map((m) => m.id)).toEqual(['claude-sonnet-4-5']);
  });

  it('sets updatedAt to an ISO timestamp and validates against the protocol schema', () => {
    const before = Date.now();
    const catalog = buildModelCatalog(stubModels([fakeModel({ id: 'm1', provider: 'stub' })]));
    const after = Date.now();

    const parsed = GatewayModelCatalogSchema.parse(catalog);
    const updatedAtMs = Date.parse(parsed.updatedAt);
    expect(Number.isNaN(updatedAtMs)).toBe(false);
    expect(updatedAtMs).toBeGreaterThanOrEqual(before);
    expect(updatedAtMs).toBeLessThanOrEqual(after);
  });

  it('defaults to the pi-ai builtin catalog and yields known providers', () => {
    const catalog = buildModelCatalog() as CatalogShape;

    expect(() => GatewayModelCatalogSchema.parse(catalog)).not.toThrow();
    expect(catalog.providers.length).toBeGreaterThan(0);
    const anthropic = catalog.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.models.some((m) => m.id === 'claude-sonnet-4-5')).toBe(true);
  });
});
