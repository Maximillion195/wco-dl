import * as path from 'path';

export interface AppConfig {
  isProd: boolean;
  port: number;
  byparrUrl: string;
  byparrMaxTimeoutMs: number;
  sonarrUrl: string;
  sonarrApiKey: string | undefined;
  corsOrigin: string;
  outputBase: string;
  pythonBin: string;
  pythonScript: string;
  downloadIdleTimeoutMs: number;
  puid: string | undefined;
  pgid: string | undefined;
  webhookUrls: string[];
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === 'production';
  const port = toInt(env.SERVER_PORT, 3000);

  return {
    isProd,
    port,
    byparrUrl: stripTrailingSlash(env.BYPARR_URL || 'http://localhost:8191'),
    byparrMaxTimeoutMs: toInt(env.BYPARR_MAX_TIMEOUT_MS, 60000),
    sonarrUrl: stripTrailingSlash(env.SONARR_URL || 'http://localhost:8989'),
    sonarrApiKey: env.SONARR_API_KEY || undefined,
    corsOrigin: env.CORS_ORIGIN || `http://localhost:${port}`,
    outputBase:
      env.OUTPUT_BASE || (isProd ? '/data/torrents/completed' : './output'),
    pythonBin: env.PYTHON_BIN || 'python',
    pythonScript: path.resolve(__dirname, '../../__main__.py'),
    downloadIdleTimeoutMs: toInt(env.DOWNLOAD_IDLE_TIMEOUT_MS, 150000),
    puid: env.PUID || undefined,
    pgid: env.PGID || undefined,
    webhookUrls: (env.WEBHOOK_URLS || '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
  };
}

export const appConfig: AppConfig = loadConfig();
