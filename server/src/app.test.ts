import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { SessionStore } from './auth/sessions.js';
import { createRateLimiter } from './auth/rateLimit.js';
import { SettingsStore } from './settings/store.js';
import { MessageStore } from './chat/messages.js';
import { ChatRunner } from './chat/runner.js';
import { SubscriptionStore } from './push/subscriptions.js';
import { fakePush, fakeStream, parseSseText } from './test/helpers.js';
import { afterEach } from 'vitest';
import { setLogLevel, setLogSink } from './log.js';

afterEach(() => {
  setLogSink(undefined);
  setLogLevel('silent');
});

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const db = openDb(':memory:');
  const messages = new MessageStore(db);
  app = createApp({
    sessions: new SessionStore(db),
    verify: async (p) => p === 'pw',
    limiter: createRateLimiter({ max: 5, windowMs: 60_000 }),
    settings: new SettingsStore(db),
    config: { hermesUrl: 'http://hermes:8642', hermesApiKey: 'k' },
    listModels: async () => ({ ok: true, models: [] }),
    messages,
    runner: new ChatRunner({
      messages, push: fakePush(), historyWindow: 40, getTarget: () => ({ url: 'x', apiKey: 'k' }),
      stream: fakeStream([{ type: 'delta', text: 'pong' }, { type: 'done' }]),
    }),
    subs: new SubscriptionStore(db),
    vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x' },
  });
});

describe('request log', () => {
  it('logs API requests with status and timing, but not health checks', async () => {
    const lines: string[] = [];
    setLogLevel('info');
    setLogSink((l) => lines.push(l));
    await app.request('/api/health');
    await app.request('/api/messages');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/INFO  http: GET \/api\/messages status=401 ms=\d+$/);
  });
});

async function loginCookie(): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw' }),
  });
  return /spooki_session=[^;]*/.exec(res.headers.get('set-cookie') ?? '')![0];
}

describe('createApp', () => {
  it('health is public', async () => {
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });

  it('protects every api route', async () => {
    for (const path of ['/api/messages', '/api/settings', '/api/push/vapid-public-key']) {
      expect((await app.request(path)).status).toBe(401);
    }
  });

  it('chats end to end with a session', async () => {
    const cookie = await loginCookie();
    const res = await app.request('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ text: 'ping' }),
    });
    expect(parseSseText(await res.text()).map((f) => f.event)).toEqual(['user', 'delta', 'done']);
    const body = await (await app.request('/api/messages', { headers: { cookie } })).json();
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(['ping', 'pong']);
    expect((await app.request('/api/settings', { headers: { cookie } })).status).toBe(200);
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const cookie = await loginCookie();
    const res = await app.request('/api/nope', { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
