import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { PasswordVerifier } from './password.js';
import type { RateLimiter } from './rateLimit.js';
import { SESSION_TTL_MS, type SessionStore } from './sessions.js';

export const SESSION_COOKIE = 'spooki_session';

export interface AuthDeps {
  verify: PasswordVerifier;
  sessions: SessionStore;
  limiter: RateLimiter;
}

// NPM sets X-Real-IP to the connecting address; X-Forwarded-For is appended to, so its
// rightmost entry is the one our proxy added (leftmost entries are client-controlled).
export function clientIp(c: Context): string {
  const real = c.req.header('x-real-ip')?.trim();
  if (real) return real;
  const parts = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? 'unknown';
}

// Browsers drop `Secure` cookies on plain http:// pages (localhost aside), which would make
// login "succeed" and then 401. So the flag follows the scheme the browser actually used:
// NPM sets X-Forwarded-Proto; a direct https URL counts too.
export function isHttps(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

export function authRoutes({ verify, sessions, limiter }: AuthDeps): Hono {
  const app = new Hono();

  app.post('/login', async (c) => {
    const ip = clientIp(c);
    if (limiter.isBlocked(ip)) return c.json({ error: 'Too many attempts, try again in a minute' }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    if (typeof body.password !== 'string' || !(await verify(body.password))) {
      limiter.recordFailure(ip);
      return c.json({ error: 'Wrong password' }, 401);
    }
    setCookie(c, SESSION_COOKIE, sessions.create(), {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ ok: true });
  });

  app.post('/logout', (c) => {
    sessions.revoke(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) });
    return c.json({ ok: true });
  });

  app.get('/me', (c) => c.json({ authenticated: sessions.validate(getCookie(c, SESSION_COOKIE)) }));

  return app;
}
