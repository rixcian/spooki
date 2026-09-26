import { createLogger, describeError } from '../log.js';
import webpush from 'web-push';
import type { StoredSubscription, SubscriptionStore } from './subscriptions.js';
import type { VapidKeys } from './vapid.js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushSender {
  sendToAll(p: PushPayload): Promise<void>;
}

export type SendFn = (
  sub: StoredSubscription,
  payload: string,
  options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number },
) => Promise<unknown>;

const defaultSend: SendFn = (sub, payload, options) => webpush.sendNotification(sub, payload, options);

export function createPushSender(
  subs: SubscriptionStore,
  vapid: VapidKeys,
  send: SendFn = defaultSend,
): PushSender {
  const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  return {
    async sendToAll(p) {
      const payload = JSON.stringify(p);
      const targets = subs.all();
      if (targets.length === 0) {
        log.info('no devices subscribed; nothing sent', { title: p.title });
        return;
      }
      let sent = 0;
      await Promise.all(
        targets.map(async (s) => {
          const host = new URL(s.endpoint).host;
          try {
            await send(s, payload, { vapidDetails, TTL: 24 * 60 * 60 });
            sent++;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              subs.remove(s.endpoint);
              log.info('removed expired subscription', { service: host, status });
            } else {
              const body = (err as { body?: string }).body;
              log.error('send failed', { service: host, status, error: describeError(err), body: body?.slice(0, 200) });
            }
          }
        }),
      );
      log.info('sent', { title: p.title, devices: sent, of: targets.length });
    },
  };
}

const log = createLogger('push');

export function previewText(text: string, max = 150): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
