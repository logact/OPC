/**
 * LLM model configuration for the edge agent runtime.
 *
 * Primary path: callers pass EdgeModelOptions at agent initialization —
 * provider id, model id, and optionally an explicit API key. All pi-ai
 * built-in providers are registered via builtinModels(), so `provider` is
 * any pi-ai provider id ("anthropic", "openai", "google", "deepseek",
 * "openrouter", ...). When `apiKey` is set it is forwarded on every request
 * (explicit per-request keys win in pi-ai); when omitted, pi-ai resolves the
 * provider's standard env var (e.g. ANTHROPIC_API_KEY) at request time.
 *
 * Fallback path: createModelConfigFromEnv() maps EDGE_MODEL_PROVIDER /
 * EDGE_MODEL_ID / EDGE_MODEL_API_KEY / EDGE_MODEL_BASE_URL onto the same
 * factory, for the CLI entrypoint in index.ts.
 */

import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { Api, Model, Models } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

// 供 agent-gateway 构建模型目录（buildModelCatalog）使用的默认目录来源。
export { builtinModels };

export interface EdgeModelOptions {
  /** pi-ai provider id, e.g. "anthropic", "deepseek", "openrouter". */
  provider: string;
  /** Model id within that provider's catalog. */
  modelId: string;
  /** Explicit API key; when omitted the provider's env var auth is used. */
  apiKey?: string;
  /** Override the provider catalog's base URL (e.g. regional endpoint or plan-specific URL). */
  baseUrl?: string;
}

export interface EdgeModelConfig {
  model: Model<Api>;
  streamFn: StreamFn;
}

export function createModelConfig(
  options: EdgeModelOptions,
  models: Models = builtinModels(),
): EdgeModelConfig {
  const catalogModel = models.getModel(options.provider, options.modelId);
  if (!catalogModel) {
    throw new Error(
      `unknown model "${options.modelId}" for provider "${options.provider}"`,
    );
  }
  const model = options.baseUrl ? { ...catalogModel, baseUrl: options.baseUrl } : catalogModel;
  const apiKey = options.apiKey;
  const streamFn: StreamFn = (m, context, streamOptions) =>
    models.streamSimple(m, context, {
      ...streamOptions,
      ...(apiKey != null ? { apiKey } : {}),
    });
  return { model, streamFn };
}

export function createModelConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EdgeModelConfig {
  const modelId = env.EDGE_MODEL_ID;
  if (!modelId) {
    throw new Error('EDGE_MODEL_ID is required to configure the edge agent model');
  }
  return createModelConfig({
    provider: env.EDGE_MODEL_PROVIDER ?? 'anthropic',
    modelId,
    ...(env.EDGE_MODEL_API_KEY != null ? { apiKey: env.EDGE_MODEL_API_KEY } : {}),
    ...(env.EDGE_MODEL_BASE_URL != null ? { baseUrl: env.EDGE_MODEL_BASE_URL } : {}),
  });
}
