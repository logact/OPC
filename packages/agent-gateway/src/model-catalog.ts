import {
  GatewayModelCatalogSchema,
  type GatewayModelCatalog,
  type ModelInfo,
} from '@logact-pub/opc-protocol';
import { builtinModels } from '@opc/agent-edge';

/**
 * gateway 模型目录构建：pi-ai 内建模型目录 → GatewayModelCatalog 的纯映射。
 *
 * gateway 启动时将结果 PATCH 到 server（UpdateParticipantRequest.modelCatalog），
 * server 持久化到 gateway participant 的 `metadata.modelCatalog`，
 * mobile Add Agent 页面据此动态渲染 provider/model 选项。
 */

/** pi-ai Model 中目录映射依赖的字段子集（结构类型，避免直接依赖 pi-ai 类型） */
export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

/** pi-ai Models 的枚举接口子集；builtinModels() 返回值天然满足该结构 */
export interface ModelCatalogSource {
  getModels(provider?: string): readonly ModelCatalogEntry[];
}

/** 按 provider 分组并映射目录字段；updatedAt 取当前时间（ISO 8601） */
export function buildModelCatalog(
  models: ModelCatalogSource = builtinModels()
): GatewayModelCatalog {
  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of models.getModels()) {
    const info: ModelInfo = {
      id: model.id,
      name: model.name,
      ...(model.reasoning !== undefined && { reasoning: model.reasoning }),
      ...(model.contextWindow !== undefined && { contextWindow: model.contextWindow }),
      ...(model.maxTokens !== undefined && { maxTokens: model.maxTokens }),
    };
    const group = byProvider.get(model.provider) ?? [];
    group.push(info);
    byProvider.set(model.provider, group);
  }
  return GatewayModelCatalogSchema.parse({
    providers: [...byProvider.entries()].map(([provider, providerModels]) => ({
      provider,
      models: providerModels,
    })),
    updatedAt: new Date().toISOString(),
  });
}
