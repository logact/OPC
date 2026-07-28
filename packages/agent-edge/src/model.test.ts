import type { Models, ModelsSimpleStreamOptions } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { createModelConfig, createModelConfigFromEnv } from './model.js';
import { fakeModel } from './testing.js';

interface StubModels {
  models: Models;
  streamCalls: { options?: ModelsSimpleStreamOptions }[];
}

function stubModels(): StubModels {
  const streamCalls: StubModels['streamCalls'] = [];
  const models = {
    getModel: (provider: string, id: string) =>
      provider === 'stub' && id === 'stub-model' ? fakeModel() : undefined,
    streamSimple: (_model: unknown, _context: unknown, options?: ModelsSimpleStreamOptions) => {
      streamCalls.push({ options });
      return undefined;
    },
  } as unknown as Models;
  return { models, streamCalls };
}

const EMPTY_CONTEXT = { messages: [] };

describe('createModelConfig', () => {
  it('returns the model resolved from the provider catalog', () => {
    const { models } = stubModels();
    const config = createModelConfig({ provider: 'stub', modelId: 'stub-model' }, models);
    expect(config.model).toEqual(fakeModel());
  });

  it('throws on unknown provider or model id', () => {
    const { models } = stubModels();
    expect(() => createModelConfig({ provider: 'nope', modelId: 'stub-model' }, models)).toThrow(
      /unknown model "stub-model" for provider "nope"/,
    );
    expect(() => createModelConfig({ provider: 'stub', modelId: 'nope' }, models)).toThrow(
      /unknown model "nope" for provider "stub"/,
    );
  });

  it('forwards an explicit apiKey on every stream call', () => {
    const { models, streamCalls } = stubModels();
    const config = createModelConfig(
      { provider: 'stub', modelId: 'stub-model', apiKey: 'sk-test' },
      models,
    );
    void config.streamFn(config.model, EMPTY_CONTEXT, { reasoning: 'low' });
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].options?.apiKey).toBe('sk-test');
    expect(streamCalls[0].options?.reasoning).toBe('low');
  });

  it('omits apiKey when not configured, leaving env auth to pi-ai', () => {
    const { models, streamCalls } = stubModels();
    const config = createModelConfig({ provider: 'stub', modelId: 'stub-model' }, models);
    void config.streamFn(config.model, EMPTY_CONTEXT);
    expect(streamCalls[0].options?.apiKey).toBeUndefined();
  });

  it('resolves a real built-in catalog entry without network', () => {
    const config = createModelConfig({ provider: 'anthropic', modelId: 'claude-sonnet-4-5' });
    expect(config.model.provider).toBe('anthropic');
    expect(config.model.id).toBe('claude-sonnet-4-5');
  });
});

describe('createModelConfigFromEnv', () => {
  it('throws when EDGE_MODEL_ID is missing', () => {
    expect(() => createModelConfigFromEnv({})).toThrow(/EDGE_MODEL_ID is required/);
  });

  it('maps env vars onto model options, defaulting provider to anthropic', () => {
    const config = createModelConfigFromEnv({ EDGE_MODEL_ID: 'claude-sonnet-4-5' });
    expect(config.model.provider).toBe('anthropic');
    expect(config.model.id).toBe('claude-sonnet-4-5');
  });

  it('honors EDGE_MODEL_PROVIDER and EDGE_MODEL_API_KEY', () => {
    const config = createModelConfigFromEnv({
      EDGE_MODEL_PROVIDER: 'openai',
      EDGE_MODEL_ID: 'gpt-5',
      EDGE_MODEL_API_KEY: 'sk-env',
    });
    expect(config.model.provider).toBe('openai');
    expect(config.model.id).toBe('gpt-5');
  });
});
