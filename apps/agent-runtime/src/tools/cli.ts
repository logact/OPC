import { spawn } from 'node:child_process';
import type { ToolEngine, ToolRunContext } from './types.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** 通用 CLI spawn：收集 stdout/stderr，超时杀进程，非零退出码 reject */
export function spawnCli(command: string, args: string[], ctx: ToolRunContext): Promise<string> {
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${command} spawn failed: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

export abstract class CliToolEngine implements ToolEngine {
  abstract readonly name: string;
  protected abstract readonly command: string;
  protected abstract buildArgs(prompt: string): string[];

  run(prompt: string, ctx: ToolRunContext): Promise<string> {
    return spawnCli(this.command, this.buildArgs(prompt), ctx);
  }
}
