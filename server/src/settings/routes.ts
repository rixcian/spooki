import { Hono } from 'hono';
import type { Config } from '../config.js';
import type { ListModels } from '../hermes/client.js';
import { HERMES_KEY_KEY, HERMES_URL_KEY, effectiveHermes, type SettingsStore } from './store.js';

export interface SettingsView {
  hermesUrl: string;
  urlSource: 'settings' | 'env';
  apiKeySet: boolean;
  apiKeyLast4: string | null;
  keySource: 'settings' | 'env';
}

interface SettingsDeps {
  settings: SettingsStore;
  config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>;
  listModels: ListModels;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function settingsRoutes({ settings, config, listModels }: SettingsDeps): Hono {
  const app = new Hono();

  const view = (): SettingsView => {
    const e = effectiveHermes(settings, config);
    return {
      hermesUrl: e.url,
      urlSource: e.urlSource,
      apiKeySet: e.apiKey !== '',
      apiKeyLast4: e.apiKey ? e.apiKey.slice(-4) : null,
      keySource: e.keySource,
    };
  };

  app.get('/', (c) => c.json(view()));

  app.put('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hermesUrl?: unknown; hermesApiKey?: unknown };
    const url = typeof body.hermesUrl === 'string' ? body.hermesUrl.trim() : '';
    const key = typeof body.hermesApiKey === 'string' ? body.hermesApiKey.trim() : '';
    if (url && !isHttpUrl(url)) return c.json({ error: 'Invalid URL, use http:// or https://' }, 400);
    if (url) settings.set(HERMES_URL_KEY, url);
    if (key) settings.set(HERMES_KEY_KEY, key);
    return c.json(view());
  });

  app.delete('/', (c) => {
    settings.delete(HERMES_URL_KEY);
    settings.delete(HERMES_KEY_KEY);
    return c.json(view());
  });

  app.post('/test', async (c) => c.json(await listModels(effectiveHermes(settings, config))));

  return app;
}
