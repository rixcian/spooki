import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db.js';

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class SessionStore {
  constructor(private db: DB, private now: () => number = Date.now) {}

  create(): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare(`INSERT INTO sessions (id, expires_at) VALUES (?, ?)`)
      .run(hashToken(token), this.now() + SESSION_TTL_MS);
    return token;
  }

  validate(token: string | undefined): boolean {
    if (!token) return false;
    const row = this.db.prepare(`SELECT expires_at FROM sessions WHERE id = ?`).get(hashToken(token)) as
      | { expires_at: number }
      | undefined;
    return row !== undefined && row.expires_at > this.now();
  }

  revoke(token: string | undefined): void {
    if (!token) return;
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(hashToken(token));
  }
}
