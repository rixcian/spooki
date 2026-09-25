import type { Config } from '../config.js';
import type { DB } from '../db.js';
import type { HermesTarget } from '../hermes/client.js';

export const HERMES_URL_KEY = 'hermes_url';
export const HERMES_KEY_KEY = 'hermes_api_key';
export const BOT_NAME_KEY = 'bot_name';
export const DEFAULT_BOT_NAME = 'Hermik';
export const MAX_BOT_NAME = 40;

export class SettingsStore {
  constructor(private db: DB) {}

  get(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  delete(key: string): void {
    this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  }
}

export function botName(settings: SettingsStore): string {
  return settings.get(BOT_NAME_KEY) ?? DEFAULT_BOT_NAME;
}

export interface EffectiveHermes extends HermesTarget {
  urlSource: 'settings' | 'env';
  keySource: 'settings' | 'env';
}

export function effectiveHermes(
  settings: SettingsStore,
  config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>,
): EffectiveHermes {
  const url = settings.get(HERMES_URL_KEY);
  const apiKey = settings.get(HERMES_KEY_KEY);
  return {
    url: url ?? config.hermesUrl,
    apiKey: apiKey ?? config.hermesApiKey,
    urlSource: url !== undefined ? 'settings' : 'env',
    keySource: apiKey !== undefined ? 'settings' : 'env',
  };
}
