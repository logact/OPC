import { CliToolEngine } from './cli.js';

/** Claude Code CLI 非交互模式：`claude -p "<prompt>"` */
export class ClaudeCodeToolEngine extends CliToolEngine {
  readonly name = 'claude-code';
  protected readonly command = 'claude';

  protected buildArgs(prompt: string): string[] {
    return ['-p', prompt];
  }
}
