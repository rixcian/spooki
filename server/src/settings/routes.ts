import { Hono } from 'hono';
import type { Config } from '../config.js';
import type { ListModels } from '../hermes/client.js';
import {
  BOT_NAME_KEY,
  HERMES_KEY_KEY,
  HERMES_URL_KEY,
  MAX_BOT_NAME,
  botName,
  effectiveHermes,
  type SettingsStore,
} from './store.js';

export interface SettingsView {
  hermesUrl: string;
  urlSource: 'settings' | 'env';
  apiKeySet: boolean;
  apiKeyLast4: string | null;
  keySource: 'settings' | 'env';
  botName: string;
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
      botName: botName(settings),
    };
  };

  app.get('/', (c) => c.json(view()));

  app.put('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hermesUrl?: unknown; hermesApiKey?: unknown; botName?: unknown };
    const url = typeof body.hermesUrl === 'string' ? body.hermesUrl.trim() : '';
    const key = typeof body.hermesApiKey === 'string' ? body.hermesApiKey.trim() : '';
    const name = typeof body.botName === 'string' ? body.botName.trim() : '';
    if (url && !isHttpUrl(url)) return c.json({ error: 'Invalid URL, use http:// or https://' }, 400);
    if (name.length > MAX_BOT_NAME) return c.json({ error: `Name must be at most ${MAX_BOT_NAME} characters` }, 400);
    if (name) settings.set(BOT_NAME_KEY, name);
    if (url) settings.set(HERMES_URL_KEY, url);
    if (key) settings.set(HERMES_KEY_KEY, key);
    return c.json(view());
  });

  // Resets the Hermes connection only; the bot's name is kept.
  app.delete('/', (c) => {
    settings.delete(HERMES_URL_KEY);
    settings.delete(HERMES_KEY_KEY);
    return c.json(view());
  });

  app.post('/test', async (c) => c.json(await listModels(effectiveHermes(settings, config))));

  return app;
}
