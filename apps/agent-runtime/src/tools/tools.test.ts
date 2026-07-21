import { describe, expect, it } from 'vitest';
import { ShellToolEngine } from './shell.js';
import { KimiToolEngine } from './kimi.js';
import { ClaudeCodeToolEngine } from './claude-code.js';

describe('ShellToolEngine', () => {
  it('runs a command and returns stdout', async () => {
    const engine = new ShellToolEngine();
    const out = await engine.run('echo hello-opc', { cwd: process.cwd() });
    expect(out).toBe('hello-opc');
  });

  it('rejects on non-zero exit code', async () => {
    const engine = new ShellToolEngine();
    await expect(engine.run('exit 3', { cwd: process.cwd() })).rejects.toThrow('code 3');
  });

  it('rejects on timeout', async () => {
    const engine = new ShellToolEngine();
    await expect(engine.run('sleep 5', { cwd: process.cwd(), timeoutMs: 100 })).rejects.toThrow('timed out');
  });
});

describe('CLI arg construction', () => {
  it('kimi uses -p print mode', () => {
    const engine = new KimiToolEngine();
    expect(engine['buildArgs']('do something')).toEqual(['-p', 'do something']);
  });

  it('claude-code uses -p print mode', () => {
    const engine = new ClaudeCodeToolEngine();
    expect(engine['buildArgs']('do something')).toEqual(['-p', 'do something']);
  });
});
