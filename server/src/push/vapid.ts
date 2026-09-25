import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import type { Config } from '../config.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function loadOrCreateVapid(
  config: Pick<Config, 'dataDir' | 'vapidPublicKey' | 'vapidPrivateKey' | 'vapidSubject'>,
): VapidKeys {
  const subject = config.vapidSubject;
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject };
  }
  const file = join(config.dataDir, 'vapid.json');
  if (existsSync(file)) {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { publicKey: string; privateKey: string };
    return { publicKey: stored.publicKey, privateKey: stored.privateKey, subject };
  }
  const generated = webpush.generateVAPIDKeys();
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(generated), { mode: 0o600 });
  return { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
}
