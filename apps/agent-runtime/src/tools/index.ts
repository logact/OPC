import type { EngineKind } from '../config.js';
import type { ToolEngine } from './types.js';
import { ShellToolEngine } from './shell.js';
import { KimiToolEngine } from './kimi.js';
import { ClaudeCodeToolEngine } from './claude-code.js';

export function createEngine(kind: EngineKind): ToolEngine {
  switch (kind) {
    case 'shell':
      return new ShellToolEngine();
    case 'kimi':
      return new KimiToolEngine();
    case 'claude-code':
      return new ClaudeCodeToolEngine();
  }
}

export type { ToolEngine, ToolRunContext } from './types.js';
