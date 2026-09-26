import type { DB } from '../db.js';

export type Role = 'user' | 'assistant';
export type Source = 'chat' | 'cron';
export type Status = 'complete' | 'error';

export interface Message {
  id: number;
  role: Role;
  source: Source;
  content: string;
  status: Status;
  cronJob: string | null;
  createdAt: string;
}

export interface NewMessage {
  role: Role;
  source: Source;
  content: string;
  status?: Status;
  cronJob?: string | null;
}

interface Row {
  id: number;
  role: Role;
  source: Source;
  content: string;
  status: Status;
  cron_job: string | null;
  created_at: string;
}

const toMessage = (r: Row): Message => ({
  id: r.id,
  role: r.role,
  source: r.source,
  content: r.content,
  status: r.status,
  cronJob: r.cron_job,
  createdAt: r.created_at,
});

export class MessageStore {
  constructor(private db: DB) {}

  add(m: NewMessage): Message {
    const row = this.db
      .prepare(
        `INSERT INTO messages (role, source, content, status, cron_job) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(m.role, m.source, m.content, m.status ?? 'complete', m.cronJob ?? null) as Row;
    return toMessage(row);
  }

  list(limit = 500): Message[] {
    const rows = this.db
      .prepare(`SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC`)
      .all(limit) as Row[];
    return rows.map(toMessage);
  }

  last(): Message | undefined {
    return this.list(1)[0];
  }

  delete(id: number): void {
    this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
  }
}
