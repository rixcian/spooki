import { Hono } from 'hono';
import type { Config } from './config.js';
import { requireSession } from './auth/middleware.js';
import type { PasswordVerifier } from './auth/password.js';
import type { RateLimiter } from './auth/rateLimit.js';
import { authRoutes } from './auth/routes.js';
import type { SessionStore } from './auth/sessions.js';
import type { MessageStore } from './chat/messages.js';
import { chatRoutes } from './chat/routes.js';
import type { ChatRunner } from './chat/runner.js';
import type { ListModels } from './hermes/client.js';
import { pushRoutes } from './push/routes.js';
import type { SubscriptionStore } from './push/subscriptions.js';
import type { VapidKeys } from './push/vapid.js';
import { settingsRoutes } from './settings/routes.js';
import type { SettingsStore } from './settings/store.js';

export interface AppDeps {
  sessions: SessionStore;
  verify: PasswordVerifier;
  limiter: RateLimiter;
  settings: SettingsStore;
  config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>;
  listModels: ListModels;
  messages: MessageStore;
  runner: ChatRunner;
  subs: SubscriptionStore;
  vapid: VapidKeys;
}

export function createApp(d: AppDeps): Hono {
  const app = new Hono();
  app.use('/api/*', requireSession(d.sessions));
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes({ verify: d.verify, sessions: d.sessions, limiter: d.limiter }));
  app.route('/api/settings', settingsRoutes({ settings: d.settings, config: d.config, listModels: d.listModels }));
  app.route('/api/push', pushRoutes({ subs: d.subs, vapid: d.vapid }));
  app.route('/api', chatRoutes({ messages: d.messages, runner: d.runner }));
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
  return app;
}
