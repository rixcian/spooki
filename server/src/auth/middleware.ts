import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { SESSION_COOKIE } from './routes.js';
import type { SessionStore } from './sessions.js';

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/auth/me', '/api/health']);

export function requireSession(sessions: SessionStore) {
  return createMiddleware(async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path) || sessions.validate(getCookie(c, SESSION_COOKIE))) {
      await next();
      return;
    }
    return c.json({ error: 'Unauthorized' }, 401);
  });
}
