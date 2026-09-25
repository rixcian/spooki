import { mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { createPasswordVerifier } from './auth/password.js';
import { createRateLimiter } from './auth/rateLimit.js';
import { SessionStore } from './auth/sessions.js';
import { MessageStore } from './chat/messages.js';
import { ChatRunner } from './chat/runner.js';
import { loadConfig } from './config.js';
import { CronSeenStore } from './cron/seen.js';
import { startCronWatcher } from './cron/watcher.js';
import { openDb } from './db.js';
import { listModels, streamChat } from './hermes/client.js';
import { createPushSender } from './push/sender.js';
import { SubscriptionStore } from './push/subscriptions.js';
import { loadOrCreateVapid } from './push/vapid.js';
import { SettingsStore, botName, effectiveHermes } from './settings/store.js';

async function main() {
  const config = loadConfig(process.env);
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(join(config.dataDir, 'hermik.db'));

  const messages = new MessageStore(db);
  const settings = new SettingsStore(db);
  const sessions = new SessionStore(db);
  const subs = new SubscriptionStore(db);
  const seen = new CronSeenStore(db);
  const vapid = loadOrCreateVapid(config);
  const push = createPushSender(subs, vapid);
  const runner = new ChatRunner({
    messages,
    push,
    stream: streamChat,
    historyWindow: config.historyWindow,
    getTarget: () => effectiveHermes(settings, config),
    botName: () => botName(settings),
  });

  const app = createApp({
    sessions,
    verify: await createPasswordVerifier(config.appPassword),
    limiter: createRateLimiter({ max: 5, windowMs: 60_000 }),
    settings,
    config,
    listModels,
    messages,
    runner,
    subs,
    vapid,
  });

  // serveStatic resolves `root` relative to cwd.
  const root = relative(process.cwd(), resolve(config.clientDist)) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ path: join(root, 'index.html') })); // SPA fallback

  await startCronWatcher({ dir: config.cronOutputDir, seen, messages, push, botName: () => botName(settings) });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`hermik listening on :${info.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
