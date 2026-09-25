import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.js';
import { loadOrCreateVapid } from './vapid.js';
import { SubscriptionStore, type StoredSubscription } from './subscriptions.js';
import { createPushSender, previewText } from './sender.js';
import { pushRoutes } from './routes.js';

const sub = (n: number): StoredSubscription => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });
const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y.z' };
let subs: SubscriptionStore;
beforeEach(() => { subs = new SubscriptionStore(openDb(':memory:')); });

describe('loadOrCreateVapid', () => {
  it('generates once and persists', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hermik-'));
    const cfg = { dataDir, vapidSubject: 'mailto:a@b.c' };
    const first = loadOrCreateVapid(cfg);
    expect(first.publicKey.length).toBeGreaterThan(20);
    expect(first.subject).toBe('mailto:a@b.c');
    expect(loadOrCreateVapid(cfg)).toEqual(first);
  });

  it('uses env keys when both are provided', () => {
    const k = loadOrCreateVapid({ dataDir: '/nonexistent', vapidPublicKey: 'P', vapidPrivateKey: 'Q', vapidSubject: 'mailto:s' });
    expect(k).toEqual({ publicKey: 'P', privateKey: 'Q', subject: 'mailto:s' });
  });
});

describe('SubscriptionStore', () => {
  it('upserts by endpoint and removes', () => {
    subs.upsert(sub(1));
    subs.upsert({ ...sub(1), keys: { p256dh: 'new', auth: 'new' } });
    subs.upsert(sub(2));
    expect(subs.all()).toEqual([{ ...sub(1), keys: { p256dh: 'new', auth: 'new' } }, sub(2)]);
    subs.remove(sub(1).endpoint);
    expect(subs.all()).toEqual([sub(2)]);
  });
});

describe('createPushSender', () => {
  it('sends to every subscription and prunes gone ones', async () => {
    subs.upsert(sub(1));
    subs.upsert(sub(2));
    subs.upsert(sub(3));
    const sent: { endpoint: string; payload: string }[] = [];
    const logs: unknown[] = [];
    const sender = createPushSender(
      subs,
      vapid,
      async (s, payload, options) => {
        expect(options.vapidDetails).toEqual(vapid);
        sent.push({ endpoint: s.endpoint, payload });
        if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
        if (s.endpoint.endsWith('/3')) throw Object.assign(new Error('oops'), { statusCode: 500 });
      },
      (...a) => logs.push(a),
    );
    await sender.sendToAll({ title: 'Hermes', body: 'hello', url: '/' });
    expect(sent).toHaveLength(3);
    expect(JSON.parse(sent[0].payload)).toEqual({ title: 'Hermes', body: 'hello', url: '/' });
    expect(subs.all().map((s) => s.endpoint)).toEqual([sub(1).endpoint, sub(3).endpoint]);
    expect(logs).toHaveLength(1);
  });
});

describe('previewText', () => {
  it('collapses whitespace and truncates to 150 chars', () => {
    expect(previewText('a\n\n  b')).toBe('a b');
    const long = previewText('x'.repeat(300));
    expect(long).toHaveLength(150);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('push routes', () => {
  it('serves the public key and stores subscriptions', async () => {
    const app = pushRoutes({ subs, vapid });
    expect(await (await app.request('/vapid-public-key')).json()).toEqual({ publicKey: 'pub' });
    const post = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/subscribe', { endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } })).status).toBe(400);
    expect((await post('/subscribe', { endpoint: 'https://push.example/1' })).status).toBe(400);
    expect((await post('/subscribe', sub(1))).status).toBe(200);
    expect(subs.all()).toEqual([sub(1)]);
    expect((await post('/unsubscribe', { endpoint: sub(1).endpoint })).status).toBe(200);
    expect(subs.all()).toEqual([]);
  });
});
