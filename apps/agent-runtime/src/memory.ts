import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface MemoryEntry {
  ts: string;
  role: 'task' | 'result';
  body: string;
}

/** 文件型 memory store：每 agent 一个 JSON 文件，追加式记录任务与结果 */
export class FileMemoryStore {
  private entries: MemoryEntry[] | undefined;

  constructor(private readonly filePath: string) {}

  async load(): Promise<MemoryEntry[]> {
    if (this.entries) return this.entries;
    try {
      this.entries = JSON.parse(await readFile(this.filePath, 'utf8')) as MemoryEntry[];
    } catch {
      this.entries = [];
    }
    return this.entries;
  }

  async append(role: MemoryEntry['role'], body: string): Promise<void> {
    const entries = await this.load();
    entries.push({ ts: new Date().toISOString(), role, body });
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2));
  }

  /** 渲染为注入 engine prompt 的上下文文本 */
  async renderContext(limit = 20): Promise<string> {
    const entries = await this.load();
    const recent = entries.slice(-limit);
    if (recent.length === 0) return '';
    const lines = recent.map((e) => `[${e.ts}] ${e.role === 'task' ? 'TASK' : 'RESULT'}: ${e.body}`);
    return `# Memory (recent ${recent.length} entries)\n${lines.join('\n')}\n\n`;
  }
}
