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

  it('falls back to the default port for invalid values', () => {
    expect(loadConfig({ SERVER_PORT: 'abc' }).port).toBe(3000);
  });
});
