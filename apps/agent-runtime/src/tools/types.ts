export interface ToolRunContext {
  cwd: string;
  /** 单次执行超时（ms），默认 10 分钟 */
  timeoutMs?: number;
}

/** CLI 工具引擎：接收完整 prompt，返回 stdout 文本 */
export interface ToolEngine {
  readonly name: string;
  run(prompt: string, ctx: ToolRunContext): Promise<string>;
}
