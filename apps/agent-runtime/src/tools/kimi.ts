import { CliToolEngine } from './cli.js';

/** Kimi Code CLI 一次性模式：`kimi -p "<prompt>"` 执行并退出 */
export class KimiToolEngine extends CliToolEngine {
  readonly name = 'kimi';
  protected readonly command = 'kimi';

  protected buildArgs(prompt: string): string[] {
    return ['-p', prompt];
  }
}
