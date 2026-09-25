import { Hono } from 'hono';
import type { SubscriptionStore } from './subscriptions.js';
import type { VapidKeys } from './vapid.js';

export function pushRoutes({ subs, vapid }: { subs: SubscriptionStore; vapid: VapidKeys }): Hono {
  const app = new Hono();

  app.get('/vapid-public-key', (c) => c.json({ publicKey: vapid.publicKey }));

  app.post('/subscribe', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    const { endpoint, keys } = body;
    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('https://') ||
      typeof keys?.p256dh !== 'string' ||
      typeof keys?.auth !== 'string'
    ) {
      return c.json({ error: 'Invalid push subscription' }, 400);
    }
    subs.upsert({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    return c.json({ ok: true });
  });

  app.post('/unsubscribe', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
    if (typeof body.endpoint === 'string') subs.remove(body.endpoint);
    return c.json({ ok: true });
  });

  return app;
}
