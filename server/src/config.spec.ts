import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses localhost defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.byparrUrl).toBe('http://localhost:8191');
    expect(config.sonarrUrl).toBe('http://localhost:8989');
    expect(config.sonarrApiKey).toBeUndefined();
    expect(config.outputBase).toBe('./output');
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      SERVER_PORT: '4000',
      BYPARR_URL: 'http://byparr:8191/',
      SONARR_URL: 'http://sonarr:8989',
      SONARR_API_KEY: 'secret',
      OUTPUT_BASE: '/data/downloads',
    });
    expect(config.port).toBe(4000);
    expect(config.byparrUrl).toBe('http://byparr:8191');
    expect(config.sonarrUrl).toBe('http://sonarr:8989');
    expect(config.sonarrApiKey).toBe('secret');
    expect(config.outputBase).toBe('/data/downloads');
    expect(loadConfig({ NODE_ENV: 'production' }).outputBase).toBe(
      '/data/torrents/completed',
    );
    expect(config.corsOrigin).toBe('http://localhost:4000');
  });

  it('parses comma-separated webhook URLs', () => {
    expect(loadConfig({}).webhookUrls).toEqual([]);
    expect(
      loadConfig({ WEBHOOK_URLS: ' http://a.test/hook,, https://b.test ' })
        .webhookUrls,
    ).toEqual(['http://a.test/hook', 'https://b.test']);
  });

  it('blocks internal webhooks unless WEBHOOK_ALLOW_INTERNAL=true', () => {
    expect(loadConfig({}).webhookAllowInternal).toBe(false);
    expect(
      loadConfig({ WEBHOOK_ALLOW_INTERNAL: '1' }).webhookAllowInternal,
    ).toBe(false);
    expect(
      loadConfig({ WEBHOOK_ALLOW_INTERNAL: 'true' }).webhookAllowInternal,
    ).toBe(true);
  });

  it('gives downloads 3.5 minutes of silence before killing them', () => {
    expect(loadConfig({}).downloadIdleTimeoutMs).toBe(210000);
    expect(
      loadConfig({ DOWNLOAD_IDLE_TIMEOUT_MS: '60000' }).downloadIdleTimeoutMs,
    ).toBe(60000);
  });

  it('falls back to the default port for invalid values', () => {
    expect(loadConfig({ SERVER_PORT: 'abc' }).port).toBe(3000);
  });
});
