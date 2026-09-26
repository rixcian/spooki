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
  log: (...a: unknown[]) => void = console.error,
): PushSender {
  const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  return {
    async sendToAll(p) {
      const payload = JSON.stringify(p);
      await Promise.all(
        subs.all().map(async (s) => {
          try {
            await send(s, payload, { vapidDetails, TTL: 24 * 60 * 60 });
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) subs.remove(s.endpoint);
            else log('push: send failed', s.endpoint, err);
          }
        }),
      );
    },
  };
}

export function previewText(text: string, max = 150): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
