import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ APP_PASSWORD: 'pw' })).toEqual({
      port: 3000,
      appPassword: 'pw',
      hermesUrl: 'http://hermes:8642',
      hermesApiKey: '',
      cronOutputDir: '/hermes/cron/output',
      dataDir: '/data',
      historyWindow: 40,
      clientDist: '../client/dist',
      vapidPublicKey: undefined,
      vapidPrivateKey: undefined,
      vapidSubject: 'mailto:admin@localhost',
    });
  });

  it('reads every variable', () => {
    const c = loadConfig({
      APP_PASSWORD: 'pw', PORT: '8080', HERMES_URL: 'http://h:1', HERMES_API_KEY: 'k',
      CRON_OUTPUT_DIR: '/c', DATA_DIR: '/d', HISTORY_WINDOW: '10', CLIENT_DIST: '/web',
      VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:me@x.cz',
    });
    expect(c).toMatchObject({
      port: 8080, hermesUrl: 'http://h:1', hermesApiKey: 'k', cronOutputDir: '/c',
      dataDir: '/d', historyWindow: 10, clientDist: '/web',
      vapidPublicKey: 'pub', vapidPrivateKey: 'priv', vapidSubject: 'mailto:me@x.cz',
    });
  });

  it('requires APP_PASSWORD', () => {
    expect(() => loadConfig({})).toThrow('APP_PASSWORD is required');
  });

  it('rejects non-numeric PORT', () => {
    expect(() => loadConfig({ APP_PASSWORD: 'pw', PORT: 'abc' })).toThrow('PORT must be a positive integer');
  });
});
