import type { DB } from '../db.js';

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class SubscriptionStore {
  constructor(private db: DB) {}

  upsert(s: StoredSubscription): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, keys_json) VALUES (?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json`,
      )
      .run(s.endpoint, JSON.stringify(s.keys));
  }

  remove(endpoint: string): void {
    this.db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
  }

  all(): StoredSubscription[] {
    const rows = this.db.prepare(`SELECT endpoint, keys_json FROM push_subscriptions ORDER BY id`).all() as {
      endpoint: string;
      keys_json: string;
    }[];
    return rows.map((r) => ({ endpoint: r.endpoint, keys: JSON.parse(r.keys_json) }));
  }
}
