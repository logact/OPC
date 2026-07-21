import type { ToolEngine, ToolRunContext } from './types.js';
import { spawnCli } from './cli.js';

/** 直接工具：prompt 即 shell 命令文本 */
export class ShellToolEngine implements ToolEngine {
  readonly name = 'shell';

  run(prompt: string, ctx: ToolRunContext): Promise<string> {
    return spawnCli('bash', ['-c', prompt], ctx);
  }
}
