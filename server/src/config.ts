export interface Config {
  port: number;
  appPassword: string;
  hermesUrl: string;
  hermesApiKey: string;
  cronOutputDir: string;
  dataDir: string;
  historyWindow: number;
  clientDist: string;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject: string;
}

function toInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const appPassword = env.APP_PASSWORD;
  if (!appPassword) throw new Error('APP_PASSWORD is required');
  return {
    port: toInt(env.PORT, 3000, 'PORT'),
    appPassword,
    hermesUrl: env.HERMES_URL || 'http://hermes:8642',
    hermesApiKey: env.HERMES_API_KEY ?? '',
    cronOutputDir: env.CRON_OUTPUT_DIR || '/hermes/cron/output',
    dataDir: env.DATA_DIR || '/data',
    historyWindow: toInt(env.HISTORY_WINDOW, 40, 'HISTORY_WINDOW'),
    clientDist: env.CLIENT_DIST || '../client/dist',
    vapidPublicKey: env.VAPID_PUBLIC_KEY || undefined,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || undefined,
    vapidSubject: env.VAPID_SUBJECT || 'mailto:admin@localhost',
  };
}
