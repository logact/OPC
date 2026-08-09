import { InMemoryMemoryStore, type MemoryRecord, type MemoryStore } from '@opc/memory';
import type { GatewayStateStore } from './state.js';

/**
 * Bridges the generic memory package to the gateway's local SQLite state.
 * The in-memory fallback preserves normal runtime behavior if SQLite cannot
 * be opened; once state is available each scope is durable across restarts.
 */
export function createGatewayMemoryStore(
  getState: () => GatewayStateStore | undefined,
): MemoryStore {
  const fallback = new InMemoryMemoryStore();
  const current = (): GatewayStateStore | undefined => getState();

  return {
    async list(scope: string): Promise<readonly MemoryRecord[]> {
      return current()?.listMemories(scope) ?? fallback.list(scope);
    },
    async put(memory: MemoryRecord): Promise<void> {
      const state = current();
      if (state) {
        state.putMemory(memory);
        return;
      }
      await fallback.put(memory);
    },
    async delete(scope: string, id: string): Promise<boolean> {
      return current()?.deleteMemory(scope, id) ?? fallback.delete(scope, id);
    },
    async clear(scope: string): Promise<number> {
      return current()?.clearMemories(scope) ?? fallback.clear(scope);
    },
  };
}
