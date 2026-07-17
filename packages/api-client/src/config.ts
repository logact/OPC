export interface OpcApiConfig {
  baseURL: string;
  apiVersion?: string;
  timeout?: number;
}

export function buildBaseURL(config: OpcApiConfig): string {
  const version = config.apiVersion ?? 'v1';
  const base = config.baseURL.replace(/\/$/, '');
  return `${base}/api/${version}`;
}
