import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { openDb } from '../db.js';
import { createPasswordVerifier } from './password.js';
import { SessionStore, SESSION_TTL_MS } from './sessions.js';
import { createRateLimiter } from './rateLimit.js';
import { authRoutes, SESSION_COOKIE } from './routes.js';
import { requireSession } from './middleware.js';

function cookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(header);
  return match ? `${SESSION_COOKIE}=${match[1]}` : '';
}

let sessions: SessionStore;
let app: Hono;

beforeEach(() => {
  sessions = new SessionStore(openDb(':memory:'));
  app = new Hono();
  app.use('/api/*', requireSession(sessions));
  app.route(
    '/api/auth',
    authRoutes({ verify: async (p) => p === 'pw', sessions, limiter: createRateLimiter({ max: 5, windowMs: 60_000 }) }),
  );
  app.get('/api/secret', (c) => c.text('secret'));
});

const login = (password: string, ip = '1.1.1.1', proto = 'https') =>
  app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, 'x-forwarded-proto': proto },
    body: JSON.stringify({ password }),
  });

describe('auth', () => {
  it('rejects protected routes without a session', async () => {
    const res = await app.request('/api/secret');
    expect(res.status).toBe(401);
  });

  it('logs in with the right password and sets a secure cookie', async () => {
    const res = await login('pw');
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Strict/i);
    const secret = await app.request('/api/secret', { headers: { cookie: cookieFrom(res) } });
    expect(await secret.text()).toBe('secret');
  });

  it('omits Secure over plain HTTP so the browser keeps the cookie (e.g. a Tailscale IP)', async () => {
    const res = await login('pw', '1.1.1.1', 'http');
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).not.toMatch(/Secure/i);
  });

  it('treats a direct https URL as secure even without a proxy header', async () => {
    const res = await app.request('https://spooki.example/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    });
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Secure/i);
  });

  it('rejects a wrong password', async () => {
    const res = await login('nope');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rate limits after 5 failures per IP', async () => {
    for (let i = 0; i < 5; i++) expect((await login('nope')).status).toBe(401);
    expect((await login('pw')).status).toBe(429);
    expect((await login('pw', '2.2.2.2')).status).toBe(200);
  });

  it('/me reports session state without requiring one', async () => {
    const anon = await app.request('/api/auth/me');
    expect(await anon.json()).toEqual({ authenticated: false });
    const cookie = cookieFrom(await login('pw'));
    const me = await app.request('/api/auth/me', { headers: { cookie } });
    expect(await me.json()).toEqual({ authenticated: true });
  });

  it('logout revokes the session', async () => {
    const cookie = cookieFrom(await login('pw'));
    await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(401);
  });
});

describe('SessionStore', () => {
  it('expires sessions after the TTL', () => {
    let now = 1_000;
    const store = new SessionStore(openDb(':memory:'), () => now);
    const token = store.create();
    expect(store.validate(token)).toBe(true);
    now += SESSION_TTL_MS + 1;
    expect(store.validate(token)).toBe(false);
  });

  it('rejects unknown and missing tokens', () => {
    const store = new SessionStore(openDb(':memory:'));
    expect(store.validate('nope')).toBe(false);
    expect(store.validate(undefined)).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('forgets failures after the window', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(true);
    now = 1001;
    expect(limiter.isBlocked('a')).toBe(false);
  });
});

describe('createPasswordVerifier', () => {
  it('verifies with argon2', async () => {
    const verify = await createPasswordVerifier('correct horse');
    expect(await verify('correct horse')).toBe(true);
    expect(await verify('wrong')).toBe(false);
  });
});
