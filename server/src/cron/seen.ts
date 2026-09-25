import type { DB } from '../db.js';

export class CronSeenStore {
  constructor(private db: DB) {}

  has(path: string): boolean {
    return this.db.prepare(`SELECT 1 FROM cron_seen WHERE path = ?`).get(path) !== undefined;
  }

  add(path: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO cron_seen (path) VALUES (?)`).run(path);
  }

  remove(path: string): void {
    this.db.prepare(`DELETE FROM cron_seen WHERE path = ?`).run(path);
  }
}
