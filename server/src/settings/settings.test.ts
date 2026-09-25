import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db.js';
import type { HermesTarget } from '../hermes/client.js';
import { SettingsStore, effectiveHermes } from './store.js';
import { settingsRoutes } from './routes.js';

const config = { hermesUrl: 'http://hermes:8642', hermesApiKey: 'env-key-1234' };
let settings: SettingsStore;
let tested: HermesTarget[];
let app: ReturnType<typeof settingsRoutes>;

beforeEach(() => {
  settings = new SettingsStore(openDb(':memory:'));
  tested = [];
  app = settingsRoutes({
    settings,
    config,
    listModels: async (t) => { tested.push(t); return { ok: true, models: ['hermes-agent'] }; },
  });
});

const put = (body: unknown) =>
  app.request('/', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('effectiveHermes', () => {
  it('falls back to env and prefers settings', () => {
    expect(effectiveHermes(settings, config)).toEqual({ url: config.hermesUrl, apiKey: config.hermesApiKey, urlSource: 'env', keySource: 'env' });
    settings.set('hermes_url', 'http://other:1');
    expect(effectiveHermes(settings, config)).toMatchObject({ url: 'http://other:1', urlSource: 'settings', keySource: 'env' });
  });
});

describe('settings routes', () => {
  it('GET shows effective values and masks the key', async () => {
    const res = await app.request('/');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      hermesUrl: 'http://hermes:8642', urlSource: 'env', apiKeySet: true, apiKeyLast4: '1234', keySource: 'env',
    });
    expect(text).not.toContain('env-key-1234');
  });

  it('PUT overrides url and key; empty key is ignored', async () => {
    const res = await put({ hermesUrl: ' http://custom:9000 ', hermesApiKey: 'new-secret-abcd' });
    const body = await res.json();
    expect(body).toMatchObject({ hermesUrl: 'http://custom:9000', urlSource: 'settings', apiKeyLast4: 'abcd', keySource: 'settings' });
    expect(JSON.stringify(body)).not.toContain('new-secret-abcd');
    await put({ hermesApiKey: '' });
    expect(settings.get('hermes_api_key')).toBe('new-secret-abcd');
  });

  it('PUT rejects an invalid URL', async () => {
    const res = await put({ hermesUrl: 'not a url' });
    expect(res.status).toBe(400);
    const ftp = await put({ hermesUrl: 'ftp://x' });
    expect(ftp.status).toBe(400);
  });

  it('DELETE resets to env', async () => {
    await put({ hermesUrl: 'http://custom:9000', hermesApiKey: 'x' });
    const res = await app.request('/', { method: 'DELETE' });
    expect(await res.json()).toMatchObject({ urlSource: 'env', keySource: 'env' });
  });

  it('POST /test uses the effective target', async () => {
    await put({ hermesUrl: 'http://custom:9000' });
    const res = await app.request('/test', { method: 'POST' });
    expect(await res.json()).toEqual({ ok: true, models: ['hermes-agent'] });
    expect(tested[0]).toMatchObject({ url: 'http://custom:9000', apiKey: 'env-key-1234' });
  });
});
