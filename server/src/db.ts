import Database from 'better-sqlite3';

export type DB = Database.Database;

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  source TEXT NOT NULL CHECK (source IN ('chat', 'cron')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'error')),
  cron_job TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS cron_seen (
  path TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at INTEGER NOT NULL
);
`;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
