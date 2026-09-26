# Spooki PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user chat PWA plus a small Node server that proxies to a self-hosted Hermes Agent, keeps history in SQLite, and turns Hermes cron results into Web Push notifications. It replaces the Telegram bot.

**Architecture:** One Node process (Hono) serves the built React PWA and exposes `/api/*`. It streams chat replies from Hermes' OpenAI-compatible API (`/v1/chat/completions`, `stream: true`) back to the phone as SSE. The Hermes run continues even when the phone disconnects. A chokidar watcher turns new files in Hermes' cron output directory into chat messages and pushes. Password login uses a session cookie. Everything is deployed with Docker behind Nginx Proxy Manager.

**Tech Stack:** Node 22, TypeScript (strict, ESM), Hono + @hono/node-server, better-sqlite3, web-push, @node-rs/argon2, chokidar 4, Vitest; React + Vite, Tailwind CSS v4, coss ui (shadcn registry `@coss`), react-markdown + remark-gfm; Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-25-spooki-pwa-design.md`

## Global Constraints

- Node **22**, TypeScript `strict: true`, ESM everywhere (`"type": "module"`). Server relative imports use the **`.js` extension** (NodeNext).
- Single user. `APP_PASSWORD` comes from env and is never persisted in plain text.
- The Hermes API key **never reaches the browser**. Settings responses expose only `apiKeySet` and `apiKeyLast4`.
- Hermes URL/key precedence: **settings table > env**.
- Session cookie `spooki_session`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, 90 days.
- Login rate limit: **5 failed attempts per minute per client IP**. The IP comes from `X-Real-IP`, falling back to the rightmost `X-Forwarded-For` entry.
- Every `/api/*` route requires a session, except `/api/auth/login`, `/api/auth/me`, and `/api/health`.
- SSE responses set `X-Accel-Buffering: no` and `Cache-Control: no-cache`.
- History window sent to Hermes: `HISTORY_WINDOW`, default **40** messages. Cron messages are sent as `assistant` turns prefixed `[Scheduled: <job>]`.
- Only one chat run at a time. A concurrent send returns **409**.
- Push preview text: whitespace-collapsed, max **150** characters.
- No Tailscale anywhere. HTTPS is terminated by Nginx Proxy Manager.
- Out of scope: voice, images/files, multiple threads.

## Verified external facts (from Hermes source, 2026-09-25)

- Chat stream frames: `data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"..."},"finish_reason":null}]}`. First chunk has `delta.role`. Finish chunk has `finish_reason` (`"stop"` means OK; anything else is failure) and optional `error.message`. Stream ends with `data: [DONE]`.
- Tool events: `event: hermes.tool.progress` with `data: {"tool","emoji","label","toolCallId","status":"running"}`, then `{"tool","toolCallId","status":"completed"}`.
- Other named events (`hermes.status`, `approval.request`) exist and are ignored. `: keepalive` comment lines arrive every 10s. `delta.reasoning_content` chunks are ignored.
- If the HTTP client disconnects, Hermes **interrupts** the agent. So the server, not the phone, must hold the Hermes connection.
- Cron output: **every** run (whatever its delivery target) is saved to `~/.hermes/cron/output/{job_id}/{YYYY-MM-DD_HH-MM-SS}.md`. Writes are atomic via a temp file prefixed `.output_`. The file mode is `0600` and the dir mode is `0700`.
- Cron doc format: `# Cron Job: {name}`, `**Job ID:** …`, `**Run Time:** …`, `## Prompt\n\n…`, then `## Response\n\n{response}\n`. Silent runs have a response starting with `[SILENT]`. Empty runs have the response `(No response generated)`. Gate or blocked docs have no `## Response` section; gate docs contain `wakeAgent=false`.

## File Structure

```
package.json                      npm workspaces root (server, client)
.gitignore / .dockerignore / .env.example
Dockerfile / docker-compose.yml / README.md
server/
  package.json, tsconfig.json, tsconfig.build.json
  src/
    config.ts                     env → Config
    db.ts                         open SQLite + schema
    app.ts                        createApp(deps): mounts all routes
    index.ts                      production entry: wiring, static files, cron watcher
    auth/password.ts              argon2 verifier
    auth/sessions.ts              SessionStore (hashed tokens)
    auth/rateLimit.ts             in-memory failure limiter
    auth/routes.ts                /api/auth/*
    auth/middleware.ts            requireSession
    hermes/sse.ts                 SSE frame parser
    hermes/client.ts              streamChat(), listModels()
    settings/store.ts             SettingsStore + effectiveHermes()
    settings/routes.ts            /api/settings
    push/vapid.ts                 load or generate VAPID keys
    push/subscriptions.ts         SubscriptionStore
    push/sender.ts                createPushSender(), previewText()
    push/routes.ts                /api/push/*
    chat/messages.ts              MessageStore
    chat/history.ts               buildHistory()
    chat/runner.ts                ChatRunner (background runs, detach, push)
    chat/routes.ts                /api/messages, /api/chat, /api/chat/retry
    cron/parse.ts                 parseCronFile(), isCronOutputPath()
    cron/seen.ts                  CronSeenStore
    cron/watcher.ts               processFile(), initialScan(), startCronWatcher()
    test/fakeHermes.ts            HTTP fake of Hermes for client tests
    test/helpers.ts               fakeStream, fakePush, deferred, waitFor, parseSseText
    cron/__fixtures__/*.md        real-format cron docs
client/
  (Vite react-ts scaffold) index.html, vite.config.ts, components.json
  public/ sw.js, manifest.webmanifest, logo.svg, generated icons
  src/
    main.tsx, App.tsx, index.css
    lib/api.ts                    typed fetch wrapper, 401 hook
    lib/sse.ts                    parseSse() + postSse()
    lib/push.ts                   push status/enable helpers
    chat/reducer.ts               chat state machine (pure)
    chat/useChat.ts               hook: load, send, retry, reload on focus
    components/LoginScreen.tsx
    components/ChatScreen.tsx
    components/MessageBubble.tsx
    components/Composer.tsx
    components/SettingsScreen.tsx
    components/ui/*               coss ui (generated)
```

---

### Task 1: Repo scaffold + server config

**Files:**
- Create: `package.json`, `.gitignore`, `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`
- Create: `server/src/config.ts`
- Test: `server/src/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Config {
    port: number; appPassword: string; hermesUrl: string; hermesApiKey: string;
    cronOutputDir: string; dataDir: string; historyWindow: number; clientDist: string;
    vapidPublicKey?: string; vapidPrivateKey?: string; vapidSubject: string;
  }
  export function loadConfig(env: Record<string, string | undefined>): Config
  ```

- [ ] **Step 1: Create root files**

`package.json`:
```json
{
  "name": "spooki",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "test": "npm test -w server && npm test -w client",
    "build": "npm run build -w client && npm run build -w server"
  }
}
```

`.gitignore`:
```
node_modules
dist
data
.env
*.log
.DS_Store
```

`server/package.json`:
```json
{
  "name": "@spooki/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../.env src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`server/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/test/**", "src/**/__fixtures__/**"]
}
```

- [ ] **Step 2: Install server dependencies**

```bash
npm install -w server hono @hono/node-server better-sqlite3 web-push @node-rs/argon2 chokidar
```
```bash
npm install -D -w server typescript tsx vitest @types/node @types/better-sqlite3 @types/web-push
```

- [ ] **Step 3: Write the failing test** — `server/src/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ APP_PASSWORD: 'pw' })).toEqual({
      port: 3000,
      appPassword: 'pw',
      hermesUrl: 'http://hermes:8642',
      hermesApiKey: '',
      cronOutputDir: '/hermes/cron/output',
      dataDir: '/data',
      historyWindow: 40,
      clientDist: '../client/dist',
      vapidPublicKey: undefined,
      vapidPrivateKey: undefined,
      vapidSubject: 'mailto:admin@localhost',
    });
  });

  it('reads every variable', () => {
    const c = loadConfig({
      APP_PASSWORD: 'pw', PORT: '8080', HERMES_URL: 'http://h:1', HERMES_API_KEY: 'k',
      CRON_OUTPUT_DIR: '/c', DATA_DIR: '/d', HISTORY_WINDOW: '10', CLIENT_DIST: '/web',
      VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:me@x.cz',
    });
    expect(c).toMatchObject({
      port: 8080, hermesUrl: 'http://h:1', hermesApiKey: 'k', cronOutputDir: '/c',
      dataDir: '/d', historyWindow: 10, clientDist: '/web',
      vapidPublicKey: 'pub', vapidPrivateKey: 'priv', vapidSubject: 'mailto:me@x.cz',
    });
  });

  it('requires APP_PASSWORD', () => {
    expect(() => loadConfig({})).toThrow('APP_PASSWORD is required');
  });

  it('rejects non-numeric PORT', () => {
    expect(() => loadConfig({ APP_PASSWORD: 'pw', PORT: 'abc' })).toThrow('PORT must be a positive integer');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -w server -- src/config.test.ts`
Expected: FAIL, cannot find module `./config.js`.

- [ ] **Step 5: Implement** — `server/src/config.ts`

```ts
export interface Config {
  port: number;
  appPassword: string;
  hermesUrl: string;
  hermesApiKey: string;
  cronOutputDir: string;
  dataDir: string;
  historyWindow: number;
  clientDist: string;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject: string;
}

function toInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const appPassword = env.APP_PASSWORD;
  if (!appPassword) throw new Error('APP_PASSWORD is required');
  return {
    port: toInt(env.PORT, 3000, 'PORT'),
    appPassword,
    hermesUrl: env.HERMES_URL || 'http://hermes:8642',
    hermesApiKey: env.HERMES_API_KEY ?? '',
    cronOutputDir: env.CRON_OUTPUT_DIR || '/hermes/cron/output',
    dataDir: env.DATA_DIR || '/data',
    historyWindow: toInt(env.HISTORY_WINDOW, 40, 'HISTORY_WINDOW'),
    clientDist: env.CLIENT_DIST || '../client/dist',
    vapidPublicKey: env.VAPID_PUBLIC_KEY || undefined,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || undefined,
    vapidSubject: env.VAPID_SUBJECT || 'mailto:admin@localhost',
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w server -- src/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore server
git commit -m "feat(server): scaffold workspace and env config"
```

---

### Task 2: SQLite schema + message store + history builder

**Files:**
- Create: `server/src/db.ts`, `server/src/chat/messages.ts`, `server/src/chat/history.ts`
- Test: `server/src/chat/messages.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // db.ts
  export type DB = Database.Database;
  export function openDb(file: string): DB            // ':memory:' allowed
  // chat/messages.ts
  export type Role = 'user' | 'assistant';
  export type Source = 'chat' | 'cron';
  export type Status = 'complete' | 'error';
  export interface Message { id: number; role: Role; source: Source; content: string; status: Status; cronJob: string | null; createdAt: string }
  export interface NewMessage { role: Role; source: Source; content: string; status?: Status; cronJob?: string | null }
  export class MessageStore { constructor(db: DB); add(m: NewMessage): Message; list(limit?: number): Message[]; last(): Message | undefined; delete(id: number): void }
  // chat/history.ts
  export interface HermesMessage { role: 'user' | 'assistant'; content: string }
  export function buildHistory(messages: Message[]): HermesMessage[]
  ```
  `list(limit)` returns the **latest** `limit` messages (default 500) in **ascending** id order.

- [ ] **Step 1: Write the failing test** — `server/src/chat/messages.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db.js';
import { MessageStore } from './messages.js';
import { buildHistory } from './history.js';

let store: MessageStore;
beforeEach(() => { store = new MessageStore(openDb(':memory:')); });

describe('MessageStore', () => {
  it('adds messages with defaults and lists them ascending', () => {
    const a = store.add({ role: 'user', source: 'chat', content: 'hi' });
    const b = store.add({ role: 'assistant', source: 'cron', content: 'report', cronJob: 'Daily' });
    expect(a).toMatchObject({ role: 'user', source: 'chat', content: 'hi', status: 'complete', cronJob: null });
    expect(typeof a.createdAt).toBe('string');
    expect(store.list().map((m) => m.id)).toEqual([a.id, b.id]);
    expect(store.list()[1].cronJob).toBe('Daily');
  });

  it('list(limit) returns the latest N in ascending order', () => {
    for (let i = 1; i <= 5; i++) store.add({ role: 'user', source: 'chat', content: `m${i}` });
    expect(store.list(2).map((m) => m.content)).toEqual(['m4', 'm5']);
  });

  it('last() and delete()', () => {
    store.add({ role: 'user', source: 'chat', content: 'q' });
    const failed = store.add({ role: 'assistant', source: 'chat', content: 'x', status: 'error' });
    expect(store.last()?.id).toBe(failed.id);
    store.delete(failed.id);
    expect(store.last()?.content).toBe('q');
  });

  it('last() is undefined when empty', () => {
    expect(store.last()).toBeUndefined();
  });
});

describe('buildHistory', () => {
  it('maps messages, prefixes cron, skips errors', () => {
    store.add({ role: 'assistant', source: 'cron', content: 'Weather is fine', cronJob: 'Morning' });
    store.add({ role: 'user', source: 'chat', content: 'thanks' });
    store.add({ role: 'assistant', source: 'chat', content: 'broken', status: 'error' });
    store.add({ role: 'user', source: 'chat', content: 'again' });
    expect(buildHistory(store.list())).toEqual([
      { role: 'assistant', content: '[Scheduled: Morning]\n\nWeather is fine' },
      { role: 'user', content: 'thanks' },
      { role: 'user', content: 'again' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- src/chat/messages.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement** — `server/src/db.ts`

```ts
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
```

`server/src/chat/messages.ts`:
```ts
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
```

`server/src/chat/history.ts`:
```ts
import type { Message } from './messages.js';

export interface HermesMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildHistory(messages: Message[]): HermesMessage[] {
  return messages
    .filter((m) => m.status === 'complete')
    .map((m) => ({
      role: m.role,
      content: m.source === 'cron' ? `[Scheduled: ${m.cronJob ?? 'cron'}]\n\n${m.content}` : m.content,
    }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- src/chat/messages.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/src/chat
git commit -m "feat(server): sqlite schema, message store, history builder"
```

---

### Task 3: Auth: password, sessions, rate limit, routes, middleware

**Files:**
- Create: `server/src/auth/password.ts`, `server/src/auth/sessions.ts`, `server/src/auth/rateLimit.ts`, `server/src/auth/routes.ts`, `server/src/auth/middleware.ts`
- Test: `server/src/auth/auth.test.ts`

**Interfaces:**
- Consumes: `openDb`, `DB` (Task 2).
- Produces:
  ```ts
  // password.ts
  export type PasswordVerifier = (candidate: string) => Promise<boolean>;
  export async function createPasswordVerifier(plain: string): Promise<PasswordVerifier>
  // sessions.ts
  export const SESSION_TTL_MS: number; // 90 days
  export class SessionStore { constructor(db: DB, now?: () => number); create(): string; validate(token: string | undefined): boolean; revoke(token: string | undefined): void }
  // rateLimit.ts
  export interface RateLimiter { isBlocked(key: string): boolean; recordFailure(key: string): void }
  export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter
  // routes.ts
  export const SESSION_COOKIE = 'spooki_session';
  export interface AuthDeps { verify: PasswordVerifier; sessions: SessionStore; limiter: RateLimiter }
  export function authRoutes(deps: AuthDeps): Hono          // POST /login, POST /logout, GET /me
  export function clientIp(c: Context): string
  // middleware.ts
  export function requireSession(sessions: SessionStore): MiddlewareHandler
  ```

- [ ] **Step 1: Write the failing test** — `server/src/auth/auth.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { openDb } from '../db.js';
import { createPasswordVerifier } from './password.js';
import { SessionStore, SESSION_TTL_MS } from './sessions.js';
import { createRateLimiter } from './rateLimit.js';
import { authRoutes, SESSION_COOKIE } from './routes.js';
import { requireSession } from './middleware.js';

function cookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(header);
  return match ? `${SESSION_COOKIE}=${match[1]}` : '';
}

let sessions: SessionStore;
let app: Hono;

beforeEach(() => {
  sessions = new SessionStore(openDb(':memory:'));
  app = new Hono();
  app.use('/api/*', requireSession(sessions));
  app.route(
    '/api/auth',
    authRoutes({ verify: async (p) => p === 'pw', sessions, limiter: createRateLimiter({ max: 5, windowMs: 60_000 }) }),
  );
  app.get('/api/secret', (c) => c.text('secret'));
});

const login = (password: string, ip = '1.1.1.1') =>
  app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ password }),
  });

describe('auth', () => {
  it('rejects protected routes without a session', async () => {
    const res = await app.request('/api/secret');
    expect(res.status).toBe(401);
  });

  it('logs in with the right password and sets a secure cookie', async () => {
    const res = await login('pw');
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Strict/i);
    const secret = await app.request('/api/secret', { headers: { cookie: cookieFrom(res) } });
    expect(await secret.text()).toBe('secret');
  });

  it('rejects a wrong password', async () => {
    const res = await login('nope');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rate limits after 5 failures per IP', async () => {
    for (let i = 0; i < 5; i++) expect((await login('nope')).status).toBe(401);
    expect((await login('pw')).status).toBe(429);
    expect((await login('pw', '2.2.2.2')).status).toBe(200);
  });

  it('/me reports session state without requiring one', async () => {
    const anon = await app.request('/api/auth/me');
    expect(await anon.json()).toEqual({ authenticated: false });
    const cookie = cookieFrom(await login('pw'));
    const me = await app.request('/api/auth/me', { headers: { cookie } });
    expect(await me.json()).toEqual({ authenticated: true });
  });

  it('logout revokes the session', async () => {
    const cookie = cookieFrom(await login('pw'));
    await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(401);
  });
});

describe('SessionStore', () => {
  it('expires sessions after the TTL', () => {
    let now = 1_000;
    const store = new SessionStore(openDb(':memory:'), () => now);
    const token = store.create();
    expect(store.validate(token)).toBe(true);
    now += SESSION_TTL_MS + 1;
    expect(store.validate(token)).toBe(false);
  });

  it('rejects unknown and missing tokens', () => {
    const store = new SessionStore(openDb(':memory:'));
    expect(store.validate('nope')).toBe(false);
    expect(store.validate(undefined)).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('forgets failures after the window', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(true);
    now = 1001;
    expect(limiter.isBlocked('a')).toBe(false);
  });
});

describe('createPasswordVerifier', () => {
  it('verifies with argon2', async () => {
    const verify = await createPasswordVerifier('correct horse');
    expect(await verify('correct horse')).toBe(true);
    expect(await verify('wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- src/auth/auth.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`server/src/auth/password.ts`:
```ts
import { hash, verify } from '@node-rs/argon2';

export type PasswordVerifier = (candidate: string) => Promise<boolean>;

export async function createPasswordVerifier(plain: string): Promise<PasswordVerifier> {
  const hashed = await hash(plain);
  return (candidate) => verify(hashed, candidate).catch(() => false);
}
```

`server/src/auth/sessions.ts`:
```ts
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
```

`server/src/auth/rateLimit.ts`:
```ts
export interface RateLimiter {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
}

export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const failures = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const cutoff = now() - opts.windowMs;
    const list = (failures.get(key) ?? []).filter((t) => t > cutoff);
    failures.set(key, list);
    return list;
  };
  return {
    isBlocked: (key) => recent(key).length >= opts.max,
    recordFailure: (key) => {
      recent(key).push(now());
    },
  };
}
```

`server/src/auth/routes.ts`:
```ts
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { PasswordVerifier } from './password.js';
import type { RateLimiter } from './rateLimit.js';
import { SESSION_TTL_MS, type SessionStore } from './sessions.js';

export const SESSION_COOKIE = 'spooki_session';

export interface AuthDeps {
  verify: PasswordVerifier;
  sessions: SessionStore;
  limiter: RateLimiter;
}

// NPM sets X-Real-IP to the connecting address; X-Forwarded-For is appended to, so its
// rightmost entry is the one our proxy added (leftmost entries are client-controlled).
export function clientIp(c: Context): string {
  const real = c.req.header('x-real-ip')?.trim();
  if (real) return real;
  const parts = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? 'unknown';
}

export function authRoutes({ verify, sessions, limiter }: AuthDeps): Hono {
  const app = new Hono();

  app.post('/login', async (c) => {
    const ip = clientIp(c);
    if (limiter.isBlocked(ip)) return c.json({ error: 'Too many attempts, try again in a minute' }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    if (typeof body.password !== 'string' || !(await verify(body.password))) {
      limiter.recordFailure(ip);
      return c.json({ error: 'Wrong password' }, 401);
    }
    setCookie(c, SESSION_COOKIE, sessions.create(), {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ ok: true });
  });

  app.post('/logout', (c) => {
    sessions.revoke(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.json({ ok: true });
  });

  app.get('/me', (c) => c.json({ authenticated: sessions.validate(getCookie(c, SESSION_COOKIE)) }));

  return app;
}
```

`server/src/auth/middleware.ts`:
```ts
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { SESSION_COOKIE } from './routes.js';
import type { SessionStore } from './sessions.js';

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/auth/me', '/api/health']);

export function requireSession(sessions: SessionStore) {
  return createMiddleware(async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path) || sessions.validate(getCookie(c, SESSION_COOKIE))) {
      await next();
      return;
    }
    return c.json({ error: 'Unauthorized' }, 401);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- src/auth/auth.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth
git commit -m "feat(server): password login, sessions, rate limit"
```

---

### Task 4: Hermes client (SSE parser, streamChat, listModels)

**Files:**
- Create: `server/src/hermes/sse.ts`, `server/src/hermes/client.ts`, `server/src/test/fakeHermes.ts`
- Test: `server/src/hermes/client.test.ts`

**Interfaces:**
- Consumes: `HermesMessage` from `chat/history.ts` (Task 2).
- Produces:
  ```ts
  // sse.ts
  export interface SseFrame { event: string | null; data: string }
  export function parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame>
  // client.ts
  export interface HermesTarget { url: string; apiKey: string }
  export type HermesEvent =
    | { type: 'delta'; text: string }
    | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
    | { type: 'done' }
    | { type: 'error'; message: string };
  export type StreamChat = (target: HermesTarget, messages: HermesMessage[]) => AsyncGenerator<HermesEvent>;
  export const streamChat: StreamChat;   // always ends with exactly one 'done' or 'error'
  export type ListModelsResult = { ok: true; models: string[] } | { ok: false; error: string };
  export type ListModels = (target: HermesTarget) => Promise<ListModelsResult>;
  export const listModels: ListModels;
  ```

- [ ] **Step 1: Create the fake Hermes helper** — `server/src/test/fakeHermes.ts`

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export async function startFakeHermes(
  handler: (req: RecordedRequest, res: ServerResponse) => void,
): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const recorded = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const chunk = (content: string) =>
  `data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;

export const finish = (reason: string, error?: string) =>
  `data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: reason }], ...(error ? { error: { message: error } } : {}) })}\n\n`;

export const tool = (payload: Record<string, unknown>) => `event: hermes.tool.progress\ndata: ${JSON.stringify(payload)}\n\n`;

export const DONE = 'data: [DONE]\n\n';
```

- [ ] **Step 2: Write the failing test** — `server/src/hermes/client.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { streamChat, listModels, type HermesEvent } from './client.js';
import { startFakeHermes, chunk, finish, tool, DONE } from '../test/fakeHermes.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function collect(gen: AsyncGenerator<HermesEvent>): Promise<HermesEvent[]> {
  const out: HermesEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function sse(frames: string[]) {
  return (_req: unknown, res: import('node:http').ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const f of frames) res.write(f);
    res.end();
  };
}

describe('streamChat', () => {
  it('streams deltas and finishes with done, sending auth and history', async () => {
    const fake = await startFakeHermes(
      sse([
        `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`,
        ': keepalive\n\n',
        chunk('Hel'),
        chunk('lo'),
        finish('stop'),
        DONE,
      ]),
    );
    close = fake.close;
    const events = await collect(
      streamChat({ url: `${fake.url}/`, apiKey: 'secret' }, [{ role: 'user', content: 'hi' }]),
    );
    expect(events).toEqual([{ type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }, { type: 'done' }]);
    const req = fake.requests[0];
    expect(req.url).toBe('/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer secret');
    expect(JSON.parse(req.body)).toEqual({
      model: 'hermes-agent',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
  });

  it('maps hermes.tool.progress events', async () => {
    const fake = await startFakeHermes(
      sse([
        tool({ tool: 'web_search', emoji: '🔍', label: 'web_search: cats', toolCallId: 'c1', status: 'running' }),
        tool({ tool: 'web_search', toolCallId: 'c1', status: 'completed' }),
        `event: hermes.status\ndata: {"x":1}\n\n`,
        chunk('ok'),
        DONE,
      ]),
    );
    close = fake.close;
    const events = await collect(streamChat({ url: fake.url, apiKey: 'k' }, []));
    expect(events).toEqual([
      { type: 'tool', phase: 'started', id: 'c1', name: 'web_search', label: 'web_search: cats', emoji: '🔍' },
      { type: 'tool', phase: 'completed', id: 'c1', name: 'web_search', label: undefined, emoji: undefined },
      { type: 'delta', text: 'ok' },
      { type: 'done' },
    ]);
  });

  it('turns a non-stop finish_reason into an error', async () => {
    const fake = await startFakeHermes(sse([chunk('partial'), finish('error', 'model exploded'), DONE]));
    close = fake.close;
    const events = await collect(streamChat({ url: fake.url, apiKey: 'k' }, []));
    expect(events).toEqual([{ type: 'delta', text: 'partial' }, { type: 'error', message: 'model exploded' }]);
  });

  it('reports HTTP errors', async () => {
    const fake = await startFakeHermes((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"bad key"}');
    });
    close = fake.close;
    const events = await collect(streamChat({ url: fake.url, apiKey: 'k' }, []));
    expect(events).toEqual([{ type: 'error', message: 'Hermes HTTP 401: {"error":"bad key"}' }]);
  });

  it('reports a stream that ends without [DONE]', async () => {
    const fake = await startFakeHermes(sse([chunk('cut')]));
    close = fake.close;
    const events = await collect(streamChat({ url: fake.url, apiKey: 'k' }, []));
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Stream ended unexpectedly' });
  });

  it('reports an unreachable server', async () => {
    const events = await collect(streamChat({ url: 'http://127.0.0.1:1', apiKey: 'k' }, []));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect((events[0] as { message: string }).message).toMatch(/^Cannot reach Hermes/);
  });
});

describe('listModels', () => {
  it('returns model ids', async () => {
    const fake = await startFakeHermes((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'hermes-agent' }] }));
    });
    close = fake.close;
    expect(await listModels({ url: fake.url, apiKey: 'k' })).toEqual({ ok: true, models: ['hermes-agent'] });
    expect(fake.requests[0].headers.authorization).toBe('Bearer k');
  });

  it('returns an error for non-2xx', async () => {
    const fake = await startFakeHermes((_req, res) => { res.writeHead(401); res.end(); });
    close = fake.close;
    expect(await listModels({ url: fake.url, apiKey: 'k' })).toEqual({ ok: false, error: 'HTTP 401' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w server -- src/hermes/client.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`server/src/hermes/sse.ts`:
```ts
export interface SseFrame {
  event: string | null;
  data: string;
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = null;
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
    }
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.releaseLock();
  }
}
```

`server/src/hermes/client.ts`:
```ts
import type { HermesMessage } from '../chat/history.js';
import { parseSse } from './sse.js';

export interface HermesTarget {
  url: string;
  apiKey: string;
}

export type HermesEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type StreamChat = (target: HermesTarget, messages: HermesMessage[]) => AsyncGenerator<HermesEvent>;

export type ListModelsResult = { ok: true; models: string[] } | { ok: false; error: string };
export type ListModels = (target: HermesTarget) => Promise<ListModelsResult>;

const baseUrl = (url: string) => url.replace(/\/+$/, '');
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const streamChat: StreamChat = async function* (target, messages) {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(target.url)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify({ model: 'hermes-agent', messages, stream: true }),
    });
  } catch (err) {
    yield { type: 'error', message: `Cannot reach Hermes: ${errMsg(err)}` };
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    yield { type: 'error', message: `Hermes HTTP ${res.status}: ${text.slice(0, 200)}` };
    return;
  }
  try {
    for await (const frame of parseSse(res.body)) {
      if (frame.data === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      if (frame.event === 'hermes.tool.progress') {
        const p = safeJson(frame.data);
        if (p && typeof p.tool === 'string') {
          yield {
            type: 'tool',
            phase: p.status === 'completed' ? 'completed' : 'started',
            id: String(p.toolCallId ?? ''),
            name: p.tool,
            label: p.label,
            emoji: p.emoji,
          };
        }
        continue;
      }
      if (frame.event !== null) continue; // hermes.status, approval.request, …
      const parsed = safeJson(frame.data);
      const choice = parsed?.choices?.[0];
      if (!choice) continue;
      const content = choice.delta?.content;
      if (typeof content === 'string' && content) yield { type: 'delta', text: content };
      if (choice.finish_reason && choice.finish_reason !== 'stop') {
        yield { type: 'error', message: parsed.error?.message ?? `Hermes finished with reason "${choice.finish_reason}"` };
        return;
      }
    }
  } catch (err) {
    yield { type: 'error', message: `Stream broke: ${errMsg(err)}` };
    return;
  }
  yield { type: 'error', message: 'Stream ended unexpectedly' };
};

export const listModels: ListModels = async (target) => {
  try {
    const res = await fetch(`${baseUrl(target.url)}/v1/models`, {
      headers: { authorization: `Bearer ${target.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, models: (body.data ?? []).map((m) => m.id) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w server -- src/hermes/client.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/hermes server/src/test/fakeHermes.ts
git commit -m "feat(server): hermes streaming client"
```

---

### Task 5: Settings store + routes

**Files:**
- Create: `server/src/settings/store.ts`, `server/src/settings/routes.ts`
- Test: `server/src/settings/settings.test.ts`

**Interfaces:**
- Consumes: `DB`, `openDb` (Task 2); `Config` (Task 1); `HermesTarget`, `ListModels` (Task 4).
- Produces:
  ```ts
  // store.ts
  export const HERMES_URL_KEY = 'hermes_url'; export const HERMES_KEY_KEY = 'hermes_api_key';
  export class SettingsStore { constructor(db: DB); get(key: string): string | undefined; set(key: string, value: string): void; delete(key: string): void }
  export interface EffectiveHermes extends HermesTarget { urlSource: 'settings' | 'env'; keySource: 'settings' | 'env' }
  export function effectiveHermes(settings: SettingsStore, config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>): EffectiveHermes
  // routes.ts
  export interface SettingsView { hermesUrl: string; urlSource: 'settings' | 'env'; apiKeySet: boolean; apiKeyLast4: string | null; keySource: 'settings' | 'env' }
  export function settingsRoutes(deps: { settings: SettingsStore; config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>; listModels: ListModels }): Hono
  // GET /  PUT / {hermesUrl?, hermesApiKey?}  DELETE /  POST /test
  ```

- [ ] **Step 1: Write the failing test** — `server/src/settings/settings.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db.js';
import type { HermesTarget } from '../hermes/client.js';
import { SettingsStore, effectiveHermes } from './store.js';
import { settingsRoutes } from './routes.js';

const config = { hermesUrl: 'http://hermes:8642', hermesApiKey: 'env-key-1234' };
let settings: SettingsStore;
let tested: HermesTarget[];
let app: ReturnType<typeof settingsRoutes>;

beforeEach(() => {
  settings = new SettingsStore(openDb(':memory:'));
  tested = [];
  app = settingsRoutes({
    settings,
    config,
    listModels: async (t) => { tested.push(t); return { ok: true, models: ['hermes-agent'] }; },
  });
});

const put = (body: unknown) =>
  app.request('/', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('effectiveHermes', () => {
  it('falls back to env and prefers settings', () => {
    expect(effectiveHermes(settings, config)).toEqual({ url: config.hermesUrl, apiKey: config.hermesApiKey, urlSource: 'env', keySource: 'env' });
    settings.set('hermes_url', 'http://other:1');
    expect(effectiveHermes(settings, config)).toMatchObject({ url: 'http://other:1', urlSource: 'settings', keySource: 'env' });
  });
});

describe('settings routes', () => {
  it('GET shows effective values and masks the key', async () => {
    const res = await app.request('/');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      hermesUrl: 'http://hermes:8642', urlSource: 'env', apiKeySet: true, apiKeyLast4: '1234', keySource: 'env',
    });
    expect(text).not.toContain('env-key-1234');
  });

  it('PUT overrides url and key; empty key is ignored', async () => {
    const res = await put({ hermesUrl: ' http://custom:9000 ', hermesApiKey: 'new-secret-abcd' });
    const body = await res.json();
    expect(body).toMatchObject({ hermesUrl: 'http://custom:9000', urlSource: 'settings', apiKeyLast4: 'abcd', keySource: 'settings' });
    expect(JSON.stringify(body)).not.toContain('new-secret-abcd');
    await put({ hermesApiKey: '' });
    expect(settings.get('hermes_api_key')).toBe('new-secret-abcd');
  });

  it('PUT rejects an invalid URL', async () => {
    const res = await put({ hermesUrl: 'not a url' });
    expect(res.status).toBe(400);
    const ftp = await put({ hermesUrl: 'ftp://x' });
    expect(ftp.status).toBe(400);
  });

  it('DELETE resets to env', async () => {
    await put({ hermesUrl: 'http://custom:9000', hermesApiKey: 'x' });
    const res = await app.request('/', { method: 'DELETE' });
    expect(await res.json()).toMatchObject({ urlSource: 'env', keySource: 'env' });
  });

  it('POST /test uses the effective target', async () => {
    await put({ hermesUrl: 'http://custom:9000' });
    const res = await app.request('/test', { method: 'POST' });
    expect(await res.json()).toEqual({ ok: true, models: ['hermes-agent'] });
    expect(tested[0]).toMatchObject({ url: 'http://custom:9000', apiKey: 'env-key-1234' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- src/settings/settings.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`server/src/settings/store.ts`:
```ts
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import type { HermesTarget } from '../hermes/client.js';

export const HERMES_URL_KEY = 'hermes_url';
export const HERMES_KEY_KEY = 'hermes_api_key';

export class SettingsStore {
  constructor(private db: DB) {}

  get(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  delete(key: string): void {
    this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  }
}

export interface EffectiveHermes extends HermesTarget {
  urlSource: 'settings' | 'env';
  keySource: 'settings' | 'env';
}

export function effectiveHermes(
  settings: SettingsStore,
  config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>,
): EffectiveHermes {
  const url = settings.get(HERMES_URL_KEY);
  const apiKey = settings.get(HERMES_KEY_KEY);
  return {
    url: url ?? config.hermesUrl,
    apiKey: apiKey ?? config.hermesApiKey,
    urlSource: url !== undefined ? 'settings' : 'env',
    keySource: apiKey !== undefined ? 'settings' : 'env',
  };
}
```

`server/src/settings/routes.ts`:
```ts
import { Hono } from 'hono';
import type { Config } from '../config.js';
import type { ListModels } from '../hermes/client.js';
import { HERMES_KEY_KEY, HERMES_URL_KEY, effectiveHermes, type SettingsStore } from './store.js';

export interface SettingsView {
  hermesUrl: string;
  urlSource: 'settings' | 'env';
  apiKeySet: boolean;
  apiKeyLast4: string | null;
  keySource: 'settings' | 'env';
}

interface SettingsDeps {
  settings: SettingsStore;
  config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>;
  listModels: ListModels;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function settingsRoutes({ settings, config, listModels }: SettingsDeps): Hono {
  const app = new Hono();

  const view = (): SettingsView => {
    const e = effectiveHermes(settings, config);
    return {
      hermesUrl: e.url,
      urlSource: e.urlSource,
      apiKeySet: e.apiKey !== '',
      apiKeyLast4: e.apiKey ? e.apiKey.slice(-4) : null,
      keySource: e.keySource,
    };
  };

  app.get('/', (c) => c.json(view()));

  app.put('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hermesUrl?: unknown; hermesApiKey?: unknown };
    const url = typeof body.hermesUrl === 'string' ? body.hermesUrl.trim() : '';
    const key = typeof body.hermesApiKey === 'string' ? body.hermesApiKey.trim() : '';
    if (url && !isHttpUrl(url)) return c.json({ error: 'Invalid URL, use http:// or https://' }, 400);
    if (url) settings.set(HERMES_URL_KEY, url);
    if (key) settings.set(HERMES_KEY_KEY, key);
    return c.json(view());
  });

  app.delete('/', (c) => {
    settings.delete(HERMES_URL_KEY);
    settings.delete(HERMES_KEY_KEY);
    return c.json(view());
  });

  app.post('/test', async (c) => c.json(await listModels(effectiveHermes(settings, config))));

  return app;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- src/settings/settings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/settings
git commit -m "feat(server): hermes connection settings with env fallback"
```

---

### Task 6: Web Push: VAPID, subscriptions, sender, routes

**Files:**
- Create: `server/src/push/vapid.ts`, `server/src/push/subscriptions.ts`, `server/src/push/sender.ts`, `server/src/push/routes.ts`
- Test: `server/src/push/push.test.ts`

**Interfaces:**
- Consumes: `DB`, `openDb` (Task 2); `Config` (Task 1).
- Produces:
  ```ts
  // vapid.ts
  export interface VapidKeys { publicKey: string; privateKey: string; subject: string }
  export function loadOrCreateVapid(config: Pick<Config, 'dataDir' | 'vapidPublicKey' | 'vapidPrivateKey' | 'vapidSubject'>): VapidKeys
  // subscriptions.ts
  export interface StoredSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
  export class SubscriptionStore { constructor(db: DB); upsert(s: StoredSubscription): void; remove(endpoint: string): void; all(): StoredSubscription[] }
  // sender.ts
  export interface PushPayload { title: string; body: string; url?: string }
  export interface PushSender { sendToAll(p: PushPayload): Promise<void> }
  export type SendFn = (sub: StoredSubscription, payload: string, options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number }) => Promise<unknown>;
  export function createPushSender(subs: SubscriptionStore, vapid: VapidKeys, send?: SendFn, log?: (...a: unknown[]) => void): PushSender
  export function previewText(text: string, max?: number): string   // default 150
  // routes.ts
  export function pushRoutes(deps: { subs: SubscriptionStore; vapid: VapidKeys }): Hono
  // GET /vapid-public-key → {publicKey}; POST /subscribe (PushSubscriptionJSON); POST /unsubscribe {endpoint}
  ```

- [ ] **Step 1: Write the failing test** — `server/src/push/push.test.ts`

```ts
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
    const dataDir = mkdtempSync(join(tmpdir(), 'spooki-'));
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- src/push/push.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`server/src/push/vapid.ts`:
```ts
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
```

`server/src/push/subscriptions.ts`:
```ts
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
```

`server/src/push/sender.ts`:
```ts
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
```

`server/src/push/routes.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- src/push/push.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/push
git commit -m "feat(server): web push with vapid and subscription pruning"
```

---

### Task 7: Chat runner + chat routes

**Files:**
- Create: `server/src/chat/runner.ts`, `server/src/chat/routes.ts`, `server/src/test/helpers.ts`
- Test: `server/src/chat/runner.test.ts`, `server/src/chat/routes.test.ts`

**Interfaces:**
- Consumes: `MessageStore`, `Message` (Task 2); `buildHistory` (Task 2); `HermesTarget`, `HermesEvent`, `StreamChat` (Task 4); `PushSender`, `PushPayload`, `previewText` (Task 6).
- Produces:
  ```ts
  // runner.ts
  export type ChatStreamEvent =
    | { type: 'user'; message: Message }
    | { type: 'delta'; text: string }
    | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
    | { type: 'done'; message: Message }
    | { type: 'error'; error: string; message: Message };
  export type Listener = (e: ChatStreamEvent) => void;
  export class BusyError extends Error {}
  export class NothingToRetryError extends Error {}
  export interface RunHandle { finished: Promise<void>; detach(): void }
  export interface ChatRunnerDeps { messages: MessageStore; getTarget: () => HermesTarget; stream: StreamChat; push: PushSender; historyWindow: number; log?: (...a: unknown[]) => void }
  export class ChatRunner { constructor(d: ChatRunnerDeps); get busy(): boolean; send(text: string, listener: Listener): RunHandle; retry(listener: Listener): RunHandle }
  // routes.ts
  export function chatRoutes(deps: { messages: MessageStore; runner: ChatRunner }): Hono
  // GET /messages → { messages: Message[]; busy: boolean }
  // POST /chat {text} → SSE (events named by ChatStreamEvent.type, data = JSON of the event)
  // POST /chat/retry → SSE;  409 busy, 400 invalid / nothing to retry
  // test/helpers.ts
  export function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void }
  export function fakeStream(events: HermesEvent[], gate?: Promise<void>): StreamChat & { calls: { target: HermesTarget; messages: HermesMessage[] }[] }
  export function fakePush(): PushSender & { sent: PushPayload[] }
  export function parseSseText(text: string): { event: string; data: any }[]
  ```

- [ ] **Step 1: Create test helpers** — `server/src/test/helpers.ts`

```ts
import type { HermesMessage } from '../chat/history.js';
import type { HermesEvent, HermesTarget, StreamChat } from '../hermes/client.js';
import type { PushPayload, PushSender } from '../push/sender.js';

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

export function fakeStream(events: HermesEvent[], gate?: Promise<void>) {
  const calls: { target: HermesTarget; messages: HermesMessage[] }[] = [];
  const fn: StreamChat = async function* (target, messages) {
    calls.push({ target, messages });
    if (gate) await gate;
    for (const e of events) yield e;
  };
  return Object.assign(fn, { calls });
}

export function fakePush(): PushSender & { sent: PushPayload[] } {
  const sent: PushPayload[] = [];
  return { sent, sendToAll: async (p) => { sent.push(p); } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSseText(text: string): { event: string; data: any }[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? 'null';
      return { event, data: JSON.parse(data) };
    });
}
```

- [ ] **Step 2: Write the failing runner test** — `server/src/chat/runner.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db.js';
import { MessageStore } from './messages.js';
import { ChatRunner, BusyError, NothingToRetryError, type ChatStreamEvent } from './runner.js';
import { deferred, fakePush, fakeStream } from '../test/helpers.js';
import type { HermesEvent } from '../hermes/client.js';

let messages: MessageStore;
beforeEach(() => { messages = new MessageStore(openDb(':memory:')); });

function makeRunner(events: HermesEvent[], gate?: Promise<void>) {
  const stream = fakeStream(events, gate);
  const push = fakePush();
  const runner = new ChatRunner({
    messages, stream, push, historyWindow: 40, getTarget: () => ({ url: 'http://h', apiKey: 'k' }), log: () => {},
  });
  return { runner, stream, push };
}

describe('ChatRunner', () => {
  it('saves the user message and the reply, emitting events in order', async () => {
    const { runner, stream, push } = makeRunner([
      { type: 'tool', phase: 'started', id: 't1', name: 'web_search' },
      { type: 'delta', text: 'Hi ' },
      { type: 'delta', text: 'there' },
      { type: 'done' },
    ]);
    const events: ChatStreamEvent[] = [];
    const handle = runner.send('hello', (e) => events.push(e));
    expect(runner.busy).toBe(true);
    await handle.finished;
    expect(runner.busy).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['user', 'tool', 'delta', 'delta', 'done']);
    expect(messages.list().map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'hello', 'complete'],
      ['assistant', 'Hi there', 'complete'],
    ]);
    expect(stream.calls[0].messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(push.sent).toEqual([]);
  });

  it('saves errors with partial text', async () => {
    const { runner } = makeRunner([{ type: 'delta', text: 'part' }, { type: 'error', message: 'boom' }]);
    const events: ChatStreamEvent[] = [];
    await runner.send('q', (e) => events.push(e)).finished;
    const last = events.at(-1) as Extract<ChatStreamEvent, { type: 'error' }>;
    expect(last.type).toBe('error');
    expect(last.error).toBe('boom');
    expect(last.message.status).toBe('error');
    expect(last.message.content).toBe('part\n\n---\n⚠️ boom');
  });

  it('rejects a second send while busy', async () => {
    const gate = deferred();
    const { runner } = makeRunner([{ type: 'done' }], gate.promise);
    const handle = runner.send('one', () => {});
    expect(() => runner.send('two', () => {})).toThrow(BusyError);
    gate.resolve();
    await handle.finished;
  });

  it('keeps running after detach and pushes the reply', async () => {
    const gate = deferred();
    const { runner, push } = makeRunner([{ type: 'delta', text: 'Background answer' }, { type: 'done' }], gate.promise);
    const events: ChatStreamEvent[] = [];
    const handle = runner.send('q', (e) => events.push(e));
    handle.detach();
    gate.resolve();
    await handle.finished;
    expect(events.map((e) => e.type)).toEqual(['user']);
    expect(messages.last()?.content).toBe('Background answer');
    expect(push.sent).toEqual([{ title: 'Hermes', body: 'Background answer', url: '/' }]);
  });

  it('retry replaces a failed reply without duplicating the user message', async () => {
    messages.add({ role: 'user', source: 'chat', content: 'q' });
    messages.add({ role: 'assistant', source: 'chat', content: 'x', status: 'error' });
    const { runner, stream } = makeRunner([{ type: 'delta', text: 'fixed' }, { type: 'done' }]);
    await runner.retry(() => {}).finished;
    expect(messages.list().map((m) => m.content)).toEqual(['q', 'fixed']);
    expect(stream.calls[0].messages).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('retry with nothing to retry throws', () => {
    messages.add({ role: 'assistant', source: 'chat', content: 'fine' });
    const { runner } = makeRunner([]);
    expect(() => runner.retry(() => {})).toThrow(NothingToRetryError);
  });

  it('treats a throwing stream as an error', async () => {
    const push = fakePush();
    const runner = new ChatRunner({
      messages, push, historyWindow: 40, getTarget: () => ({ url: '', apiKey: '' }), log: () => {},
      // eslint-disable-next-line require-yield
      stream: async function* () { throw new Error('kaput'); },
    });
    await runner.send('q', () => {}).finished;
    expect(messages.last()).toMatchObject({ status: 'error', content: '⚠️ kaput' });
    expect(runner.busy).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w server -- src/chat/runner.test.ts`
Expected: FAIL, module `./runner.js` not found.

- [ ] **Step 4: Implement** — `server/src/chat/runner.ts`

```ts
import type { HermesTarget, StreamChat } from '../hermes/client.js';
import { previewText, type PushSender } from '../push/sender.js';
import { buildHistory } from './history.js';
import type { Message, MessageStore } from './messages.js';

export type ChatStreamEvent =
  | { type: 'user'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
  | { type: 'done'; message: Message }
  | { type: 'error'; error: string; message: Message };

export type Listener = (e: ChatStreamEvent) => void;

export class BusyError extends Error {
  constructor() {
    super('A reply is already in progress');
  }
}

export class NothingToRetryError extends Error {
  constructor() {
    super('Nothing to retry');
  }
}

export interface RunHandle {
  finished: Promise<void>;
  detach(): void;
}

export interface ChatRunnerDeps {
  messages: MessageStore;
  getTarget: () => HermesTarget;
  stream: StreamChat;
  push: PushSender;
  historyWindow: number;
  log?: (...a: unknown[]) => void;
}

export class ChatRunner {
  private running = false;

  constructor(private d: ChatRunnerDeps) {}

  get busy(): boolean {
    return this.running;
  }

  send(text: string, listener: Listener): RunHandle {
    if (this.running) throw new BusyError();
    const user = this.d.messages.add({ role: 'user', source: 'chat', content: text });
    return this.run(listener, [{ type: 'user', message: user }]);
  }

  retry(listener: Listener): RunHandle {
    if (this.running) throw new BusyError();
    const last = this.d.messages.last();
    if (last?.role === 'assistant' && last.status === 'error') this.d.messages.delete(last.id);
    else if (last?.role !== 'user') throw new NothingToRetryError();
    return this.run(listener, []);
  }

  // The Hermes request is owned by the server, never by the HTTP client: Hermes interrupts the
  // agent when its caller disconnects, and iOS drops PWA connections whenever the app is hidden.
  private run(listener: Listener, initial: ChatStreamEvent[]): RunHandle {
    this.running = true;
    let attached: Listener | null = listener;
    const log = this.d.log ?? console.error;
    const emit = (e: ChatStreamEvent) => {
      try {
        attached?.(e);
      } catch (err) {
        log('chat: listener failed', err);
      }
    };
    initial.forEach(emit);

    const finished = (async () => {
      let text = '';
      let error: string | null = null;
      try {
        const history = buildHistory(this.d.messages.list(this.d.historyWindow));
        for await (const ev of this.d.stream(this.d.getTarget(), history)) {
          if (ev.type === 'delta') {
            text += ev.text;
            emit(ev);
          } else if (ev.type === 'tool') {
            emit(ev);
          } else if (ev.type === 'error') {
            error = ev.message;
            break;
          } else {
            break;
          }
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      const content = error
        ? text
          ? `${text}\n\n---\n⚠️ ${error}`
          : `⚠️ ${error}`
        : text || '(No response)';
      const saved = this.d.messages.add({
        role: 'assistant',
        source: 'chat',
        content,
        status: error ? 'error' : 'complete',
      });
      this.running = false;
      emit(error ? { type: 'error', error, message: saved } : { type: 'done', message: saved });

      if (!attached) {
        await this.d.push
          .sendToAll({ title: 'Hermes', body: previewText(saved.content), url: '/' })
          .catch((err) => log('chat: push failed', err));
      }
    })();

    return {
      finished,
      detach: () => {
        attached = null;
      },
    };
  }
}
```

- [ ] **Step 5: Run the runner tests to verify they pass**

Run: `npm test -w server -- src/chat/runner.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the failing routes test** — `server/src/chat/routes.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db.js';
import { MessageStore } from './messages.js';
import { ChatRunner } from './runner.js';
import { chatRoutes } from './routes.js';
import { deferred, fakePush, fakeStream, parseSseText } from '../test/helpers.js';
import type { HermesEvent } from '../hermes/client.js';

let messages: MessageStore;
beforeEach(() => { messages = new MessageStore(openDb(':memory:')); });

function makeApp(events: HermesEvent[], gate?: Promise<void>) {
  const runner = new ChatRunner({
    messages, stream: fakeStream(events, gate), push: fakePush(), historyWindow: 40,
    getTarget: () => ({ url: 'http://h', apiKey: 'k' }), log: () => {},
  });
  return { app: chatRoutes({ messages, runner }), runner };
}

const post = (app: ReturnType<typeof chatRoutes>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('chat routes', () => {
  it('POST /chat streams user, deltas and done as SSE', async () => {
    const { app } = makeApp([{ type: 'delta', text: 'Hey' }, { type: 'done' }]);
    const res = await post(app, '/chat', { text: 'hi' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const frames = parseSseText(await res.text());
    expect(frames.map((f) => f.event)).toEqual(['user', 'delta', 'done']);
    expect(frames[0].data.message.content).toBe('hi');
    expect(frames[2].data.message.content).toBe('Hey');
  });

  it('GET /messages returns history and busy flag', async () => {
    const { app } = makeApp([{ type: 'done' }]);
    await (await post(app, '/chat', { text: 'hi' })).text();
    const body = await (await app.request('/messages')).json();
    expect(body.busy).toBe(false);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  it('rejects empty text with 400', async () => {
    const { app } = makeApp([]);
    expect((await post(app, '/chat', { text: '   ' })).status).toBe(400);
    expect((await post(app, '/chat', {})).status).toBe(400);
  });

  it('returns 409 while a reply is in progress', async () => {
    const gate = deferred();
    const { app, runner } = makeApp([{ type: 'done' }], gate.promise);
    const first = post(app, '/chat', { text: 'one' });
    await new Promise((r) => setTimeout(r, 10));
    expect(runner.busy).toBe(true);
    expect((await post(app, '/chat', { text: 'two' })).status).toBe(409);
    gate.resolve();
    await (await first).text();
  });

  it('POST /chat/retry returns 400 when there is nothing to retry', async () => {
    const { app } = makeApp([]);
    expect((await post(app, '/chat/retry', {})).status).toBe(400);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -w server -- src/chat/routes.test.ts`
Expected: FAIL, module `./routes.js` not found.

- [ ] **Step 8: Implement** — `server/src/chat/routes.ts`

```ts
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { MessageStore } from './messages.js';
import {
  BusyError,
  NothingToRetryError,
  type ChatRunner,
  type ChatStreamEvent,
  type Listener,
  type RunHandle,
} from './runner.js';

const MAX_TEXT = 20_000;

function sse(c: Context, start: (listener: Listener) => RunHandle) {
  const pending: ChatStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let handle: RunHandle;
  try {
    handle = start((e) => {
      pending.push(e);
      wake?.();
    });
  } catch (err) {
    if (err instanceof BusyError) return c.json({ error: err.message }, 409);
    if (err instanceof NothingToRetryError) return c.json({ error: err.message }, 400);
    throw err;
  }
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache');
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => {
      handle.detach();
      wake?.();
    });
    while (!stream.aborted) {
      const e = pending.shift();
      if (!e) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      if (e.type === 'done' || e.type === 'error') break;
    }
  });
}

export function chatRoutes({ messages, runner }: { messages: MessageStore; runner: ChatRunner }): Hono {
  const app = new Hono();

  app.get('/messages', (c) => c.json({ messages: messages.list(), busy: runner.busy }));

  app.post('/chat', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > MAX_TEXT) return c.json({ error: 'Message must be 1–20000 characters' }, 400);
    return sse(c, (listener) => runner.send(text, listener));
  });

  app.post('/chat/retry', (c) => sse(c, (listener) => runner.retry(listener)));

  return app;
}
```

- [ ] **Step 9: Run all chat tests to verify they pass**

Run: `npm test -w server -- src/chat`
Expected: PASS (runner 7, routes 5, messages 5).

- [ ] **Step 10: Commit**

```bash
git add server/src/chat server/src/test/helpers.ts
git commit -m "feat(server): background chat runner with SSE streaming"
```

---

### Task 8: Cron watcher

**Files:**
- Create: `server/src/cron/parse.ts`, `server/src/cron/seen.ts`, `server/src/cron/watcher.ts`
- Create: `server/src/cron/__fixtures__/response.md`, `silent.md`, `empty.md`, `gate.md`, `blocked.md`
- Modify: `server/src/test/helpers.ts` (append `waitFor`)
- Test: `server/src/cron/cron.test.ts`

**Interfaces:**
- Consumes: `MessageStore` (Task 2); `PushSender`, `previewText` (Task 6); `fakePush` (Task 7).
- Produces:
  ```ts
  // parse.ts
  export interface CronResult { jobId: string; jobName: string; content: string }
  export function isCronOutputPath(relPath: string): boolean     // "<jobId>/YYYY-MM-DD_HH-MM-SS.md"
  export function parseCronFile(relPath: string, text: string): CronResult | null   // null = do not deliver
  // seen.ts
  export class CronSeenStore { constructor(db: DB); has(path: string): boolean; add(path: string): void; remove(path: string): void }
  // watcher.ts
  export interface CronDeps { dir: string; seen: CronSeenStore; messages: MessageStore; push: PushSender; log?: (...a: unknown[]) => void }
  export async function processFile(d: CronDeps, absPath: string): Promise<void>
  export async function initialScan(d: CronDeps): Promise<void>
  export async function startCronWatcher(d: CronDeps): Promise<{ close(): Promise<void> }>
  // test/helpers.ts (added)
  export async function waitFor(check: () => boolean, timeoutMs?: number): Promise<void>
  ```

- [ ] **Step 1: Create fixtures** (the format comes from Hermes `cron/scheduler.py`; Task 14 re-checks it against real files)

`server/src/cron/__fixtures__/response.md`:
```markdown
# Cron Job: Morning briefing

**Job ID:** a1b2c3
**Run Time:** 2026-09-25 07:00:01
**Schedule:** every day at 07:00

## Prompt

Summarize my day.

## Response

Good morning! You have **2 meetings** today.

- 10:00 standup
```

`server/src/cron/__fixtures__/silent.md`:
```markdown
# Cron Job: Watcher

**Job ID:** w1
**Run Time:** 2026-09-25 07:00:01
**Schedule:** every 5m

## Prompt

Check the site.

## Response

[SILENT]
```

`server/src/cron/__fixtures__/empty.md`:
```markdown
# Cron Job: Empty

**Job ID:** e1
**Run Time:** 2026-09-25 07:00:01
**Schedule:** every 5m

## Prompt

Do nothing.

## Response

(No response generated)
```

`server/src/cron/__fixtures__/gate.md`:
```markdown
# Cron Job: Gated

**Job ID:** g1
**Run Time:** 2026-09-25 07:00:01

Script gate returned `wakeAgent=false` — agent skipped.
```

`server/src/cron/__fixtures__/blocked.md`:
```markdown
# Cron Job: Risky

**Job ID:** r1
**Run Time:** 2026-09-25 07:00:01
**Status:** BLOCKED

The assembled prompt tripped the cron injection scanner and the agent was NOT run.
```

- [ ] **Step 2: Append `waitFor` to** `server/src/test/helpers.ts`

```ts
export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
```

- [ ] **Step 3: Write the failing test** — `server/src/cron/cron.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.js';
import { MessageStore } from '../chat/messages.js';
import { fakePush, waitFor } from '../test/helpers.js';
import { isCronOutputPath, parseCronFile } from './parse.js';
import { CronSeenStore } from './seen.js';
import { initialScan, processFile, startCronWatcher, type CronDeps } from './watcher.js';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('parseCronFile', () => {
  const p = 'a1b2c3/2026-09-25_07-00-01.md';

  it('recognises output paths', () => {
    expect(isCronOutputPath(p)).toBe(true);
    expect(isCronOutputPath('a1b2c3/.output_tmp123')).toBe(false);
    expect(isCronOutputPath('2026-09-25_07-00-01.md')).toBe(false);
    expect(isCronOutputPath('a/b/2026-09-25_07-00-01.md')).toBe(false);
  });

  it('extracts the job name and response', () => {
    expect(parseCronFile(p, fixture('response.md'))).toEqual({
      jobId: 'a1b2c3',
      jobName: 'Morning briefing',
      content: 'Good morning! You have **2 meetings** today.\n\n- 10:00 standup',
    });
  });

  it('skips silent, empty and gated runs', () => {
    expect(parseCronFile(p, fixture('silent.md'))).toBeNull();
    expect(parseCronFile(p, fixture('empty.md'))).toBeNull();
    expect(parseCronFile(p, fixture('gate.md'))).toBeNull();
  });

  it('delivers docs without a response section (blocked/errors) as their body', () => {
    const r = parseCronFile(p, fixture('blocked.md'));
    expect(r?.jobName).toBe('Risky');
    expect(r?.content).toContain('**Status:** BLOCKED');
    expect(r?.content).not.toContain('# Cron Job');
  });

  it('falls back to the job id when there is no title', () => {
    expect(parseCronFile(p, '## Response\n\nhello\n')?.jobName).toBe('a1b2c3');
  });
});

describe('cron watcher', () => {
  let dir: string;
  let deps: CronDeps & { push: ReturnType<typeof fakePush> };
  let messages: MessageStore;
  let seen: CronSeenStore;
  let closeWatcher: (() => Promise<void>) | undefined;

  const write = (rel: string, text: string) => {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    const tmp = join(abs, '..', `.output_${Math.random()}`);
    writeFileSync(tmp, text);
    renameSync(tmp, abs); // atomic, like Hermes
    return abs;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spooki-cron-'));
    const db = openDb(':memory:');
    messages = new MessageStore(db);
    seen = new CronSeenStore(db);
    deps = { dir, seen, messages, push: fakePush(), log: () => {} };
  });

  afterEach(async () => { await closeWatcher?.(); closeWatcher = undefined; });

  it('processFile saves a cron message and pushes once', async () => {
    const abs = write('a1b2c3/2026-09-25_07-00-01.md', fixture('response.md'));
    await processFile(deps, abs);
    await processFile(deps, abs);
    expect(messages.list()).toHaveLength(1);
    expect(messages.list()[0]).toMatchObject({ role: 'assistant', source: 'cron', cronJob: 'Morning briefing' });
    expect(deps.push.sent).toHaveLength(1);
    expect(deps.push.sent[0].title).toBe('Hermes · Morning briefing');
  });

  it('marks skipped files as seen without delivering', async () => {
    const abs = write('w1/2026-09-25_07-00-01.md', fixture('silent.md'));
    await processFile(deps, abs);
    expect(messages.list()).toHaveLength(0);
    expect(seen.has('w1/2026-09-25_07-00-01.md')).toBe(true);
  });

  it('first scan baselines existing files; later scans deliver new ones', async () => {
    write('a1b2c3/2026-09-24_07-00-01.md', fixture('response.md'));
    await initialScan(deps);
    expect(messages.list()).toHaveLength(0);
    write('a1b2c3/2026-09-25_07-00-01.md', fixture('response.md'));
    await initialScan(deps);
    expect(messages.list()).toHaveLength(1);
  });

  it('watches for new files', async () => {
    mkdirSync(join(dir, 'a1b2c3')); // job dir exists before the watcher starts, like on a live Hermes
    const watcher = await startCronWatcher(deps);
    closeWatcher = watcher.close;
    write('a1b2c3/2026-09-25_08-00-00.md', fixture('response.md'));
    await waitFor(() => messages.list().length === 1);
    expect(deps.push.sent).toHaveLength(1);
  });

  it('is a no-op when the directory does not exist', async () => {
    const watcher = await startCronWatcher({ ...deps, dir: join(dir, 'missing') });
    await watcher.close();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -w server -- src/cron/cron.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement**

`server/src/cron/parse.ts`:
```ts
export interface CronResult {
  jobId: string;
  jobName: string;
  content: string;
}

// Hermes writes ~/.hermes/cron/output/{job_id}/{YYYY-MM-DD_HH-MM-SS}.md (cron/jobs.py save_job_output).
const FILE_RE = /^([^/]+)\/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.md$/;
const RESPONSE_HEADING = '\n## Response\n';

export function isCronOutputPath(relPath: string): boolean {
  return FILE_RE.test(relPath);
}

export function parseCronFile(relPath: string, text: string): CronResult | null {
  const match = FILE_RE.exec(relPath);
  if (!match) return null;
  const jobId = match[1];
  const jobName = /^# Cron Job: (.+)$/m.exec(text)?.[1].trim() || jobId;

  const at = text.indexOf(RESPONSE_HEADING);
  if (at !== -1) {
    const response = text.slice(at + RESPONSE_HEADING.length).trim();
    if (!response || response === '(No response generated)' || response.startsWith('[SILENT]')) return null;
    return { jobId, jobName, content: response };
  }

  // No agent response: script-gate skips are noise; blocked/error docs are worth seeing.
  if (text.includes('wakeAgent=false')) return null;
  const body = text.replace(/^# Cron Job: .+$/m, '').trim();
  return body ? { jobId, jobName, content: body } : null;
}
```

`server/src/cron/seen.ts`:
```ts
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
```

`server/src/cron/watcher.ts`:
```ts
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { watch } from 'chokidar';
import type { MessageStore } from '../chat/messages.js';
import { previewText, type PushSender } from '../push/sender.js';
import { isCronOutputPath, parseCronFile } from './parse.js';
import type { CronSeenStore } from './seen.js';

export interface CronDeps {
  dir: string;
  seen: CronSeenStore;
  messages: MessageStore;
  push: PushSender;
  log?: (...a: unknown[]) => void;
}

// Marker row: not a valid output path, so it can never collide with a real file.
const BASELINE = '.baseline';

const toRel = (dir: string, abs: string) => relative(dir, abs).split(sep).join('/');

export async function processFile(d: CronDeps, absPath: string): Promise<void> {
  const log = d.log ?? console.error;
  const rel = toRel(d.dir, absPath);
  if (!isCronOutputPath(rel) || d.seen.has(rel)) return;
  d.seen.add(rel); // claim synchronously so concurrent add/scan events can't double-deliver

  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch (err) {
    d.seen.remove(rel); // unreadable now (e.g. permissions) — retry on next scan
    log('cron: cannot read', rel, err);
    return;
  }

  let result: ReturnType<typeof parseCronFile>;
  try {
    result = parseCronFile(rel, text);
  } catch (err) {
    log('cron: parse failed, delivering raw', rel, err);
    const jobId = rel.split('/')[0];
    result = { jobId, jobName: jobId, content: text };
  }
  if (!result) return;

  const message = d.messages.add({ role: 'assistant', source: 'cron', content: result.content, cronJob: result.jobName });
  await d.push
    .sendToAll({ title: `Hermes · ${result.jobName}`, body: previewText(message.content), url: '/' })
    .catch((err) => log('cron: push failed', err));
}

async function listOutputFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const job of await readdir(dir, { withFileTypes: true })) {
    if (!job.isDirectory() || job.name.startsWith('.')) continue;
    for (const f of await readdir(join(dir, job.name))) {
      if (f.endsWith('.md') && !f.startsWith('.')) files.push(join(dir, job.name, f));
    }
  }
  return files.sort();
}

export async function initialScan(d: CronDeps): Promise<void> {
  const files = await listOutputFiles(d.dir);
  if (!d.seen.has(BASELINE)) {
    // First run ever: don't replay months of history as notifications.
    for (const f of files) {
      const rel = toRel(d.dir, f);
      if (isCronOutputPath(rel)) d.seen.add(rel);
    }
    d.seen.add(BASELINE);
    return;
  }
  for (const f of files) await processFile(d, f);
}

export async function startCronWatcher(d: CronDeps): Promise<{ close(): Promise<void> }> {
  const log = d.log ?? console.error;
  if (!existsSync(d.dir)) {
    log(`cron: ${d.dir} does not exist; cron messages are disabled`);
    return { close: async () => {} };
  }
  await initialScan(d);
  const watcher = watch(d.dir, {
    ignoreInitial: true,
    depth: 2,
    ignored: (p: string) => p !== d.dir && basename(p).startsWith('.'),
  });
  watcher.on('add', (p: string) => {
    void processFile(d, p);
  });
  watcher.on('error', (err: unknown) => log('cron: watcher error', err));
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  return { close: () => watcher.close() };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w server -- src/cron/cron.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/cron server/src/test/helpers.ts
git commit -m "feat(server): deliver hermes cron output as chat messages"
```

---

### Task 9: App wiring + production entry

**Files:**
- Create: `server/src/app.ts`, `server/src/index.ts`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces:
  ```ts
  export interface AppDeps {
    sessions: SessionStore; verify: PasswordVerifier; limiter: RateLimiter;
    settings: SettingsStore; config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>; listModels: ListModels;
    messages: MessageStore; runner: ChatRunner; subs: SubscriptionStore; vapid: VapidKeys;
  }
  export function createApp(d: AppDeps): Hono
  ```
  Route map: `GET /api/health`, `/api/auth/*`, `/api/settings*`, `/api/push/*`, `GET /api/messages`, `POST /api/chat`, `POST /api/chat/retry`. Unknown `/api/*` → 404 JSON.

- [ ] **Step 1: Write the failing test** — `server/src/app.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { SessionStore } from './auth/sessions.js';
import { createRateLimiter } from './auth/rateLimit.js';
import { SettingsStore } from './settings/store.js';
import { MessageStore } from './chat/messages.js';
import { ChatRunner } from './chat/runner.js';
import { SubscriptionStore } from './push/subscriptions.js';
import { fakePush, fakeStream, parseSseText } from './test/helpers.js';

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const db = openDb(':memory:');
  const messages = new MessageStore(db);
  app = createApp({
    sessions: new SessionStore(db),
    verify: async (p) => p === 'pw',
    limiter: createRateLimiter({ max: 5, windowMs: 60_000 }),
    settings: new SettingsStore(db),
    config: { hermesUrl: 'http://hermes:8642', hermesApiKey: 'k' },
    listModels: async () => ({ ok: true, models: [] }),
    messages,
    runner: new ChatRunner({
      messages, push: fakePush(), historyWindow: 40, getTarget: () => ({ url: 'x', apiKey: 'k' }), log: () => {},
      stream: fakeStream([{ type: 'delta', text: 'pong' }, { type: 'done' }]),
    }),
    subs: new SubscriptionStore(db),
    vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x' },
  });
});

async function loginCookie(): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw' }),
  });
  return /spooki_session=[^;]*/.exec(res.headers.get('set-cookie') ?? '')![0];
}

describe('createApp', () => {
  it('health is public', async () => {
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });

  it('protects every api route', async () => {
    for (const path of ['/api/messages', '/api/settings', '/api/push/vapid-public-key']) {
      expect((await app.request(path)).status).toBe(401);
    }
  });

  it('chats end to end with a session', async () => {
    const cookie = await loginCookie();
    const res = await app.request('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ text: 'ping' }),
    });
    expect(parseSseText(await res.text()).map((f) => f.event)).toEqual(['user', 'delta', 'done']);
    const body = await (await app.request('/api/messages', { headers: { cookie } })).json();
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(['ping', 'pong']);
    expect((await app.request('/api/settings', { headers: { cookie } })).status).toBe(200);
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const cookie = await loginCookie();
    const res = await app.request('/api/nope', { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- src/app.test.ts`
Expected: FAIL, module `./app.js` not found.

- [ ] **Step 3: Implement** — `server/src/app.ts`

```ts
import { Hono } from 'hono';
import type { Config } from './config.js';
import { requireSession } from './auth/middleware.js';
import type { PasswordVerifier } from './auth/password.js';
import type { RateLimiter } from './auth/rateLimit.js';
import { authRoutes } from './auth/routes.js';
import type { SessionStore } from './auth/sessions.js';
import type { MessageStore } from './chat/messages.js';
import { chatRoutes } from './chat/routes.js';
import type { ChatRunner } from './chat/runner.js';
import type { ListModels } from './hermes/client.js';
import { pushRoutes } from './push/routes.js';
import type { SubscriptionStore } from './push/subscriptions.js';
import type { VapidKeys } from './push/vapid.js';
import { settingsRoutes } from './settings/routes.js';
import type { SettingsStore } from './settings/store.js';

export interface AppDeps {
  sessions: SessionStore;
  verify: PasswordVerifier;
  limiter: RateLimiter;
  settings: SettingsStore;
  config: Pick<Config, 'hermesUrl' | 'hermesApiKey'>;
  listModels: ListModels;
  messages: MessageStore;
  runner: ChatRunner;
  subs: SubscriptionStore;
  vapid: VapidKeys;
}

export function createApp(d: AppDeps): Hono {
  const app = new Hono();
  app.use('/api/*', requireSession(d.sessions));
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes({ verify: d.verify, sessions: d.sessions, limiter: d.limiter }));
  app.route('/api/settings', settingsRoutes({ settings: d.settings, config: d.config, listModels: d.listModels }));
  app.route('/api/push', pushRoutes({ subs: d.subs, vapid: d.vapid }));
  app.route('/api', chatRoutes({ messages: d.messages, runner: d.runner }));
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
  return app;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- src/app.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement the entry** — `server/src/index.ts`

```ts
import { mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { createPasswordVerifier } from './auth/password.js';
import { createRateLimiter } from './auth/rateLimit.js';
import { SessionStore } from './auth/sessions.js';
import { MessageStore } from './chat/messages.js';
import { ChatRunner } from './chat/runner.js';
import { loadConfig } from './config.js';
import { CronSeenStore } from './cron/seen.js';
import { startCronWatcher } from './cron/watcher.js';
import { openDb } from './db.js';
import { listModels, streamChat } from './hermes/client.js';
import { createPushSender } from './push/sender.js';
import { SubscriptionStore } from './push/subscriptions.js';
import { loadOrCreateVapid } from './push/vapid.js';
import { SettingsStore, effectiveHermes } from './settings/store.js';

async function main() {
  const config = loadConfig(process.env);
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(join(config.dataDir, 'spooki.db'));

  const messages = new MessageStore(db);
  const settings = new SettingsStore(db);
  const sessions = new SessionStore(db);
  const subs = new SubscriptionStore(db);
  const seen = new CronSeenStore(db);
  const vapid = loadOrCreateVapid(config);
  const push = createPushSender(subs, vapid);
  const runner = new ChatRunner({
    messages,
    push,
    stream: streamChat,
    historyWindow: config.historyWindow,
    getTarget: () => effectiveHermes(settings, config),
  });

  const app = createApp({
    sessions,
    verify: await createPasswordVerifier(config.appPassword),
    limiter: createRateLimiter({ max: 5, windowMs: 60_000 }),
    settings,
    config,
    listModels,
    messages,
    runner,
    subs,
    vapid,
  });

  // serveStatic resolves `root` relative to cwd.
  const root = relative(process.cwd(), resolve(config.clientDist)) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ path: join(root, 'index.html') })); // SPA fallback

  await startCronWatcher({ dir: config.cronOutputDir, seen, messages, push });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`spooki listening on :${info.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Typecheck, build, and smoke-run**

Run: `npm run typecheck -w server && npm run build -w server`
Expected: no errors; `server/dist/index.js` exists.

Run (a temp data dir, no client build yet):
```bash
APP_PASSWORD=pw DATA_DIR=/tmp/spooki-smoke CRON_OUTPUT_DIR=/tmp/spooki-smoke/cron node server/dist/index.js
```
In another shell: `curl -s localhost:3000/api/health` → `{"ok":true}`. The log shows `cron: … does not exist`. Stop with Ctrl+C.

- [ ] **Step 7: Run the full server suite and commit**

Run: `npm test -w server`
Expected: all tests PASS.

```bash
git add server/src/app.ts server/src/app.test.ts server/src/index.ts
git commit -m "feat(server): wire app, static hosting and cron watcher"
```

---

### Task 10: Client scaffold, API client, login

**Files:**
- Create: `client/` via Vite (react-ts), then modify `client/package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `client/tsconfig.app.json`, `client/src/index.css`, `client/src/main.tsx`, `client/src/App.tsx`
- Create: `client/src/lib/api.ts`, `client/src/components/LoginScreen.tsx`, temporary `client/src/components/ChatScreen.tsx` and `client/src/components/SettingsScreen.tsx` (replaced in Tasks 11–12)
- Test: `client/src/lib/api.test.ts`

**Interfaces:**
- Produces (`client/src/lib/api.ts`):
  ```ts
  export class ApiError extends Error { status: number }
  export interface Message { id: number; role: 'user' | 'assistant'; source: 'chat' | 'cron'; content: string; status: 'complete' | 'error'; cronJob: string | null; createdAt: string }
  export interface SettingsView { hermesUrl: string; urlSource: 'settings' | 'env'; apiKeySet: boolean; apiKeyLast4: string | null; keySource: 'settings' | 'env' }
  export type TestResult = { ok: true; models: string[] } | { ok: false; error: string };
  export function onUnauthorized(fn: () => void): void
  export function notifyUnauthorized(): void
  export const api: {
    me(): Promise<{ authenticated: boolean }>; login(password: string): Promise<unknown>; logout(): Promise<unknown>;
    messages(): Promise<{ messages: Message[]; busy: boolean }>;
    getSettings(): Promise<SettingsView>; saveSettings(s: { hermesUrl?: string; hermesApiKey?: string }): Promise<SettingsView>;
    resetSettings(): Promise<SettingsView>; testConnection(): Promise<TestResult>;
    vapidKey(): Promise<string>; subscribe(sub: PushSubscriptionJSON): Promise<unknown>;
  }
  ```

- [ ] **Step 1: Scaffold with Vite**

```bash
npm create vite@latest client -- --template react-ts --no-interactive
```
(If your create-vite version rejects `--no-interactive`, run it without that flag and answer "No" to "install and start now".)

Then set `"name": "@spooki/client"` in `client/package.json` and add `"test": "vitest run"` to its scripts. Delete `client/src/App.css`, `client/src/assets/`, and `client/public/vite.svg`.

- [ ] **Step 2: Install client dependencies**

```bash
npm install -w client tailwindcss @tailwindcss/vite @tailwindcss/typography react-markdown remark-gfm
```
```bash
npm install -D -w client vitest @types/node
```

- [ ] **Step 3: Configure Vite, TS paths and Tailwind**

`client/vite.config.ts`:
```ts
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
```

Add to `compilerOptions` in **both** `client/tsconfig.json` and `client/tsconfig.app.json`:
```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

`client/src/index.css` (the coss init in Step 4 appends theme tokens):
```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

- [ ] **Step 4: Initialise coss ui**

```bash
cd client && npx shadcn@latest init @coss/style
```
Accept the defaults. Then make sure these components exist and add any that are missing:
```bash
cd client && npx shadcn@latest add @coss/button @coss/input @coss/textarea @coss/label
```
Open `client/src/components/ui/button.tsx` and confirm it exports `Button` with `variant` values including `ghost` and `outline`, and `size` including `sm`. If the names differ, use coss's equivalents everywhere this plan uses `variant`/`size`.

- [ ] **Step 5: Write the failing test** — `client/src/lib/api.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError, onUnauthorized } from './api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api', () => {
  it('returns JSON on success', async () => {
    const fetchMock = stubFetch(200, { messages: [], busy: false });
    expect(await api.messages()).toEqual({ messages: [], busy: false });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messages');
  });

  it('throws ApiError with the server message', async () => {
    stubFetch(409, { error: 'A reply is already in progress' });
    await expect(api.getSettings()).rejects.toEqual(new ApiError(409, 'A reply is already in progress'));
  });

  it('calls the unauthorized handler on 401, except for login', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    stubFetch(401, { error: 'Unauthorized' });
    await expect(api.messages()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    stubFetch(401, { error: 'Wrong password' });
    await expect(api.login('x')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -w client -- src/lib/api.test.ts`
Expected: FAIL, cannot resolve `./api`.

- [ ] **Step 7: Implement** — `client/src/lib/api.ts`

```ts
// Explicit field, not a constructor parameter property: the Vite template enables
// `erasableSyntaxOnly`, which rejects parameter properties.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  source: 'chat' | 'cron';
  content: string;
  status: 'complete' | 'error';
  cronJob: string | null;
  createdAt: string;
}

export interface SettingsView {
  hermesUrl: string;
  urlSource: 'settings' | 'env';
  apiKeySet: boolean;
  apiKeyLast4: string | null;
  keySource: 'settings' | 'env';
}

export type TestResult = { ok: true; models: string[] } | { ok: false; error: string };

let unauthorizedHandler: () => void = () => {};
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}
export function notifyUnauthorized(): void {
  unauthorizedHandler();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') notifyUnauthorized();
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

export const api = {
  me: () => request<{ authenticated: boolean }>('/auth/me'),
  login: (password: string) => request('/auth/login', json('POST', { password })),
  logout: () => request('/auth/logout', json('POST')),
  messages: () => request<{ messages: Message[]; busy: boolean }>('/messages'),
  getSettings: () => request<SettingsView>('/settings'),
  saveSettings: (s: { hermesUrl?: string; hermesApiKey?: string }) => request<SettingsView>('/settings', json('PUT', s)),
  resetSettings: () => request<SettingsView>('/settings', json('DELETE')),
  testConnection: () => request<TestResult>('/settings/test', json('POST')),
  vapidKey: () => request<{ publicKey: string }>('/push/vapid-public-key').then((r) => r.publicKey),
  subscribe: (sub: PushSubscriptionJSON) => request('/push/subscribe', json('POST', sub)),
};
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -w client -- src/lib/api.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Login screen, temporary screens, App, main**

`client/src/components/LoginScreen.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Spooki</h1>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
```

Temporary `client/src/components/ChatScreen.tsx` (replaced in Task 11):
```tsx
export function ChatScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  return <button onClick={onOpenSettings}>Settings</button>;
}
```

Temporary `client/src/components/SettingsScreen.tsx` (replaced in Task 12):
```tsx
export function SettingsScreen({ onBack }: { onBack: () => void; onLoggedOut: () => void }) {
  return <button onClick={onBack}>Back</button>;
}
```

`client/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { ChatScreen } from '@/components/ChatScreen';
import { LoginScreen } from '@/components/LoginScreen';
import { SettingsScreen } from '@/components/SettingsScreen';
import { api, onUnauthorized } from '@/lib/api';

type View = 'loading' | 'login' | 'chat' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('loading');

  useEffect(() => {
    onUnauthorized(() => setView('login'));
    api
      .me()
      .then((r) => setView(r.authenticated ? 'chat' : 'login'))
      .catch(() => setView('login'));
  }, []);

  if (view === 'loading') {
    return <div className="grid h-dvh place-items-center text-muted-foreground">Loading…</div>;
  }
  if (view === 'login') return <LoginScreen onSuccess={() => setView('chat')} />;
  if (view === 'settings') {
    return <SettingsScreen onBack={() => setView('chat')} onLoggedOut={() => setView('login')} />;
  }
  return <ChatScreen onOpenSettings={() => setView('settings')} />;
}
```

`client/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Follow the system theme whether coss uses a `.dark` class or the media query.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 10: Verify in the browser**

Terminal 1: `APP_PASSWORD=pw DATA_DIR=/tmp/spooki-dev CRON_OUTPUT_DIR=/tmp/spooki-dev/cron npx -w server tsx src/index.ts`
Terminal 2: `npm run dev -w client`

Open `http://localhost:5173`. Expected: the login form appears. A wrong password shows "Wrong password". `pw` shows the temporary Settings button. Also run `npm run build -w client`; expected: no type errors.

- [ ] **Step 11: Commit**

```bash
git add client package.json package-lock.json
git commit -m "feat(client): vite + tailwind + coss scaffold with login"
```

---

### Task 11: Chat UI (SSE client, reducer, screen)

**Files:**
- Create: `client/src/lib/sse.ts`, `client/src/chat/reducer.ts`, `client/src/chat/useChat.ts`, `client/src/components/MessageBubble.tsx`, `client/src/components/Composer.tsx`
- Modify: `client/src/components/ChatScreen.tsx` (replace the temporary one)
- Test: `client/src/lib/sse.test.ts`, `client/src/chat/reducer.test.ts`

**Interfaces:**
- Consumes: `api`, `ApiError`, `Message`, `notifyUnauthorized` (Task 10). SSE events from the server: `user {message}`, `delta {text}`, `tool {phase,id,name,label?,emoji?}`, `done {message}`, `error {error,message}`.
- Produces:
  ```ts
  // lib/sse.ts
  export interface SseFrame { event: string | null; data: string }
  export function parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame>
  export async function postSse(path: string, body: unknown, onEvent: (event: string, data: any) => void): Promise<void>
  // chat/reducer.ts
  export interface ToolChip { id: string; name: string; label?: string; emoji?: string; done: boolean }
  export interface ChatState { messages: Message[]; streaming: { text: string; tools: ToolChip[] } | null; sending: boolean; remoteBusy: boolean; error: string | null }
  export type ChatAction = … (see code)
  export const initialChatState: ChatState
  export function chatReducer(state: ChatState, action: ChatAction): ChatState
  // chat/useChat.ts
  export function useChat(): { state: ChatState; send(text: string): void; retry(): void }
  ```

- [ ] **Step 1: Write the failing SSE test** — `client/src/lib/sse.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseSse } from './sse';

function streamOf(...parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      parts.forEach((p) => c.enqueue(enc.encode(p)));
      c.close();
    },
  });
}

describe('parseSse', () => {
  it('parses named events split across chunks and skips comments', async () => {
    const frames = [];
    for await (const f of parseSse(streamOf('event: del', 'ta\ndata: {"text":"a"}\n\n: ping\n\n', 'data: x\n\n'))) frames.push(f);
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"a"}' }, { event: null, data: 'x' }]);
  });
});
```

- [ ] **Step 2: Write the failing reducer test** — `client/src/chat/reducer.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { Message } from '@/lib/api';
import { chatReducer, initialChatState, type ChatAction, type ChatState } from './reducer';

const msg = (id: number, over: Partial<Message> = {}): Message => ({
  id, role: 'assistant', source: 'chat', content: `m${id}`, status: 'complete', cronJob: null, createdAt: '', ...over,
});

const run = (...actions: ChatAction[]): ChatState =>
  actions.reduce(chatReducer, initialChatState);

describe('chatReducer', () => {
  it('loads history and remote busy flag', () => {
    const s = run({ type: 'loaded', messages: [msg(1)], busy: true });
    expect(s.messages).toEqual([msg(1)]);
    expect(s.remoteBusy).toBe(true);
  });

  it('runs the happy path: send → user → tools/deltas → finished', () => {
    const s1 = run({ type: 'send', text: 'hi' });
    expect(s1.sending).toBe(true);
    expect(s1.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(s1.messages[0].id).toBeLessThan(0);

    const streamed: ChatAction[] = [
      { type: 'user', message: msg(5, { role: 'user', content: 'hi' }) },
      { type: 'tool', phase: 'started', id: 't1', name: 'web_search', label: 'web_search: x' },
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      { type: 'tool', phase: 'completed', id: 't1', name: 'web_search' },
    ];
    const s2 = streamed.reduce(chatReducer, s1);
    expect(s2.messages.map((m) => m.id)).toEqual([5]);
    expect(s2.streaming).toEqual({ text: 'Hello', tools: [{ id: 't1', name: 'web_search', label: 'web_search: x', done: true }] });

    const s3 = chatReducer(s2, { type: 'finished', message: msg(6, { content: 'Hello' }) });
    expect(s3.messages.map((m) => m.id)).toEqual([5, 6]);
    expect(s3.streaming).toBeNull();
    expect(s3.sending).toBe(false);
  });

  it('failed removes the optimistic message and shows the error', () => {
    const s = run({ type: 'send', text: 'hi' }, { type: 'failed', error: 'A reply is already in progress' });
    expect(s.messages).toEqual([]);
    expect(s.error).toBe('A reply is already in progress');
    expect(s.sending).toBe(false);
  });

  it('detached stops local streaming and marks the server busy', () => {
    const s = run({ type: 'send', text: 'hi' }, { type: 'user', message: msg(5, { role: 'user' }) }, { type: 'detached' });
    expect(s.sending).toBe(false);
    expect(s.streaming).toBeNull();
    expect(s.remoteBusy).toBe(true);
    expect(s.messages.map((m) => m.id)).toEqual([5]);
  });

  it('retry drops the trailing failed reply', () => {
    const s = run(
      { type: 'loaded', messages: [msg(1, { role: 'user' }), msg(2, { status: 'error' })], busy: false },
      { type: 'retry' },
    );
    expect(s.messages.map((m) => m.id)).toEqual([1]);
    expect(s.sending).toBe(true);
    expect(s.streaming).toEqual({ text: '', tools: [] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w client`
Expected: FAIL, cannot resolve `./sse` and `./reducer`.

- [ ] **Step 4: Implement** — `client/src/lib/sse.ts`

```ts
import { ApiError, notifyUnauthorized } from './api';

export interface SseFrame {
  event: string | null;
  data: string;
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = null;
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
    }
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.releaseLock();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postSse(path: string, body: unknown, onEvent: (event: string, data: any) => void): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, err.error ?? `HTTP ${res.status}`);
  }
  for await (const frame of parseSse(res.body)) {
    onEvent(frame.event ?? 'message', JSON.parse(frame.data));
  }
}
```

- [ ] **Step 5: Implement** — `client/src/chat/reducer.ts`

```ts
import type { Message } from '@/lib/api';

export interface ToolChip {
  id: string;
  name: string;
  label?: string;
  emoji?: string;
  done: boolean;
}

export interface ChatState {
  messages: Message[];
  streaming: { text: string; tools: ToolChip[] } | null;
  sending: boolean;
  remoteBusy: boolean;
  error: string | null;
}

export type ChatAction =
  | { type: 'loaded'; messages: Message[]; busy: boolean }
  | { type: 'send'; text: string }
  | { type: 'user'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
  | { type: 'finished'; message: Message }
  | { type: 'failed'; error: string }
  | { type: 'detached' }
  | { type: 'retry' };

export const initialChatState: ChatState = {
  messages: [],
  streaming: null,
  sending: false,
  remoteBusy: false,
  error: null,
};

const withoutOptimistic = (messages: Message[]) => messages.filter((m) => m.id > 0);

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded':
      return { ...state, messages: action.messages, remoteBusy: action.busy };
    case 'send':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: -Date.now(),
            role: 'user',
            source: 'chat',
            content: action.text,
            status: 'complete',
            cronJob: null,
            createdAt: new Date().toISOString(),
          },
        ],
        sending: true,
        streaming: { text: '', tools: [] },
        error: null,
      };
    case 'user':
      return { ...state, messages: [...withoutOptimistic(state.messages), action.message] };
    case 'delta':
      if (!state.streaming) return state;
      return { ...state, streaming: { ...state.streaming, text: state.streaming.text + action.text } };
    case 'tool': {
      if (!state.streaming) return state;
      const tools = state.streaming.tools;
      const next =
        action.phase === 'started'
          ? tools.some((t) => t.id === action.id)
            ? tools
            : [...tools, { id: action.id, name: action.name, label: action.label, emoji: action.emoji, done: false }]
          : tools.map((t) => (t.id === action.id ? { ...t, done: true } : t));
      return { ...state, streaming: { ...state.streaming, tools: next } };
    }
    case 'finished':
      return {
        ...state,
        messages: [...withoutOptimistic(state.messages), action.message],
        streaming: null,
        sending: false,
        remoteBusy: false,
      };
    case 'failed':
      return { ...state, messages: withoutOptimistic(state.messages), streaming: null, sending: false, error: action.error };
    case 'detached':
      return { ...state, streaming: null, sending: false, remoteBusy: true };
    case 'retry': {
      const last = state.messages.at(-1);
      const messages =
        last?.role === 'assistant' && last.status === 'error' ? state.messages.slice(0, -1) : state.messages;
      return { ...state, messages, sending: true, streaming: { text: '', tools: [] }, error: null };
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w client`
Expected: PASS (api 3, sse 1, reducer 5).

- [ ] **Step 7: Implement the hook** — `client/src/chat/useChat.ts`

```ts
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api } from '@/lib/api';
import { postSse } from '@/lib/sse';
import { chatReducer, initialChatState } from './reducer';

const BUSY_POLL_MS = 3000;

export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const sendingRef = useRef(false);
  sendingRef.current = state.sending;

  const reload = useCallback(async () => {
    if (sendingRef.current) return;
    try {
      const { messages, busy } = await api.messages();
      if (!sendingRef.current) dispatch({ type: 'loaded', messages, busy });
    } catch {
      // 401 is handled globally; other failures keep the current view.
    }
  }, []);

  useEffect(() => {
    void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  // While the server is still working on a reply we are not streaming, poll for it.
  useEffect(() => {
    if (!state.remoteBusy || state.sending) return;
    const t = setTimeout(() => void reload(), BUSY_POLL_MS);
    return () => clearTimeout(t);
  }, [state.remoteBusy, state.sending, state.messages, reload]);

  const stream = useCallback(async (path: string, body: unknown, acceptedAlready: boolean) => {
    let accepted = acceptedAlready;
    let finished = false;
    try {
      await postSse(path, body, (event, data) => {
        if (event === 'user') {
          accepted = true;
          dispatch({ type: 'user', message: data.message });
        } else if (event === 'delta') {
          dispatch({ type: 'delta', text: data.text });
        } else if (event === 'tool') {
          dispatch({ type: 'tool', phase: data.phase, id: data.id, name: data.name, label: data.label, emoji: data.emoji });
        } else if (event === 'done' || event === 'error') {
          finished = true;
          dispatch({ type: 'finished', message: data.message });
        }
      });
    } catch (err) {
      if (!accepted) {
        dispatch({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }
    // The connection dropped (e.g. iOS suspended the app); the server keeps going.
    if (!finished) dispatch({ type: 'detached' });
  }, []);

  const send = useCallback(
    (text: string) => {
      dispatch({ type: 'send', text });
      void stream('/api/chat', { text }, false);
    },
    [stream],
  );

  const retry = useCallback(() => {
    dispatch({ type: 'retry' });
    void stream('/api/chat/retry', {}, true);
  }, [stream]);

  return { state, send, retry };
}
```

Note: when `retry` fails before the server accepts it (409/400), `accepted` is already `true`, so the UI falls into `detached` and the next reload or poll shows the true state. That is intended: retry has no optimistic message to roll back.

- [ ] **Step 8: Implement the components**

`client/src/components/MessageBubble.tsx`:
```tsx
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolChip } from '@/chat/reducer';
import type { Message } from '@/lib/api';

function Markdownish({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-pre:overflow-x-auto">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {message.source === 'cron' && (
        <span className="px-1 text-xs text-muted-foreground">⏰ Scheduled: {message.cronJob}</span>
      )}
      <div
        className={`max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2 ${
          message.status === 'error' ? 'border border-destructive' : ''
        }`}
      >
        <Markdownish text={message.content} />
      </div>
    </div>
  );
}

export function StreamingBubble({ text, tools }: { text: string; tools: ToolChip[] }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tools.map((t) => (
            <span
              key={t.id}
              className={`rounded-full border px-2 py-0.5 text-xs ${t.done ? 'text-muted-foreground' : ''}`}
            >
              {t.emoji ?? '🔧'} {t.label ?? t.name}
              {t.done ? '' : '…'}
            </span>
          ))}
        </div>
      )}
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2">
        {text ? <Markdownish text={text} /> : <span className="animate-pulse text-muted-foreground">Thinking…</span>}
      </div>
    </div>
  );
}
```

`client/src/components/Composer.tsx`:
```tsx
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t bg-background px-3 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message Hermes"
        rows={1}
        className="max-h-40 min-h-10 flex-1 resize-none field-sizing-content"
      />
      <Button type="submit" disabled={disabled || !text.trim()}>
        Send
      </Button>
    </form>
  );
}
```

Replace `client/src/components/ChatScreen.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { useChat } from '@/chat/useChat';
import { Composer } from '@/components/Composer';
import { MessageBubble, StreamingBubble } from '@/components/MessageBubble';
import { Button } from '@/components/ui/button';

export function ChatScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, send, retry } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [state.messages.length, state.streaming?.text, state.streaming?.tools.length, state.remoteBusy]);

  const last = state.messages.at(-1);
  const canRetry = !state.sending && !state.remoteBusy && last?.role === 'assistant' && last.status === 'error';

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <h1 className="font-semibold">Hermes</h1>
        <Button variant="ghost" size="sm" onClick={onOpenSettings}>
          Settings
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {state.messages.length === 0 && !state.sending && (
            <p className="pt-10 text-center text-sm text-muted-foreground">Say hi to Hermes 👋</p>
          )}
          {state.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {state.streaming && <StreamingBubble text={state.streaming.text} tools={state.streaming.tools} />}
          {!state.sending && state.remoteBusy && (
            <p className="text-center text-sm text-muted-foreground">
              Hermes is still working… you&apos;ll get a notification.
            </p>
          )}
          {canRetry && (
            <div>
              <Button variant="outline" size="sm" onClick={retry}>
                Retry
              </Button>
            </div>
          )}
          {state.error && (
            <p role="alert" className="text-center text-sm text-destructive-foreground">
              {state.error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </main>
      <Composer disabled={state.sending || state.remoteBusy} onSend={send} />
    </div>
  );
}
```

- [ ] **Step 9: Verify against a fake Hermes**

Create a throwaway fake Hermes in the scratchpad (do **not** commit it), e.g. `/tmp/fake-hermes.mjs`:
```js
import http from 'node:http';
http.createServer((req, res) => {
  if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"hermes-agent"}]}'); }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const frames = [
    'event: hermes.tool.progress\ndata: {"tool":"web_search","emoji":"🔍","label":"web_search: test","toolCallId":"c1","status":"running"}\n\n',
    'event: hermes.tool.progress\ndata: {"tool":"web_search","toolCallId":"c1","status":"completed"}\n\n',
    ...'Here is **markdown** with a list:\n\n- one\n- two'.split(' ').map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w + ' ' }, finish_reason: null }] })}\n\n`),
    'data: [DONE]\n\n',
  ];
  let i = 0;
  const t = setInterval(() => { if (i < frames.length) res.write(frames[i++]); else { clearInterval(t); res.end(); } }, 150);
}).listen(8642);
```
Run `node /tmp/fake-hermes.mjs`. Start the server with `HERMES_URL=http://localhost:8642` added to the Task 10 Step 10 command, plus the client dev server. Log in and send a message.

Expected: your bubble appears right away; a 🔍 chip shows, then turns muted; text streams in word by word; the Markdown list renders; after a reload the history is still there. Stop the fake server and send again. Expected: a red-bordered error bubble and a **Retry** button. Restart the fake and click Retry; expected: the reply replaces the error.

- [ ] **Step 10: Commit**

```bash
git add client/src
git commit -m "feat(client): streaming chat screen with tool chips and retry"
```

---

### Task 12: Settings screen, push subscription, service worker, PWA manifest

**Files:**
- Create: `client/public/sw.js`, `client/public/manifest.webmanifest`, `client/public/logo.svg`, generated icons in `client/public/`
- Create: `client/src/lib/push.ts`
- Modify: `client/src/components/SettingsScreen.tsx` (replace the temporary one), `client/index.html`, `client/src/main.tsx`
- Test: `client/src/lib/push.test.ts`

**Interfaces:**
- Consumes: `api`, `SettingsView`, `TestResult` (Task 10). Server push payload: `{ title, body, url }`.
- Produces (`client/src/lib/push.ts`):
  ```ts
  export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer>
  export type PushStatus = 'unsupported' | 'needs-install' | 'denied' | 'enabled' | 'disabled';
  export function isStandalone(): boolean
  export async function pushStatus(): Promise<PushStatus>
  export async function enablePush(): Promise<void>
  ```

- [ ] **Step 1: Write the failing test** — `client/src/lib/push.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes url-safe base64 without padding', () => {
    // bytes 0xfb 0xff 0xbf → standard "+/+/" → url-safe "-_-_"
    expect(Array.from(urlBase64ToUint8Array('-_-_'))).toEqual([0xfb, 0xff, 0xbf]);
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w client -- src/lib/push.test.ts`
Expected: FAIL, cannot resolve `./push`.

- [ ] **Step 3: Implement** — `client/src/lib/push.ts`

```ts
import { api } from './api';

export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushStatus = 'unsupported' | 'needs-install' | 'denied' | 'enabled' | 'disabled';

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function pushStatus(): Promise<PushStatus> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  // iOS only exposes PushManager to Home Screen web apps.
  if (!('PushManager' in window)) return isStandalone() ? 'unsupported' : 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'enabled' : 'disabled';
}

// Must be called directly from a user gesture (iOS requirement).
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(await api.vapidKey()),
    }));
  await api.subscribe(sub.toJSON());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w client -- src/lib/push.test.ts`
Expected: PASS.

- [ ] **Step 5: Service worker** — `client/public/sw.js`

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Hermes', body: 'New message', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // keep defaults
  }
  // iOS revokes push permission if a push doesn't show a notification — always show one.
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if ('focus' in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
```

Register it in `client/src/main.tsx`, after the theme code and before `createRoot`:
```ts
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}
```

- [ ] **Step 6: Manifest, icons, HTML head**

`client/public/logo.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#111827"/>
  <text x="256" y="340" font-family="Helvetica, Arial, sans-serif" font-size="280" font-weight="700" fill="#f9fafb" text-anchor="middle">H</text>
</svg>
```

Generate icons:
```bash
cd client && npx @vite-pwa/assets-generator --preset minimal-2023 public/logo.svg
```
Expected in `client/public/`: `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`.

`client/public/manifest.webmanifest`:
```json
{
  "name": "Spooki",
  "short_name": "Hermes",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#111827",
  "icons": [
    { "src": "/pwa-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa-512x512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/maskable-icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Replace the `<head>` of `client/index.html` with:
```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
  <title>Spooki</title>
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#111827" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Hermes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</head>
```

- [ ] **Step 7: Settings screen** — replace `client/src/components/SettingsScreen.tsx`

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type SettingsView, type TestResult } from '@/lib/api';
import { enablePush, pushStatus, type PushStatus } from '@/lib/push';

const PUSH_TEXT: Record<PushStatus, string> = {
  enabled: 'Notifications are on.',
  disabled: 'Notifications are off.',
  denied: 'Notifications are blocked. Allow them in iOS Settings → Notifications → Hermes.',
  'needs-install': 'Add Spooki to your Home Screen (Share → Add to Home Screen) to enable notifications.',
  unsupported: 'This browser does not support push notifications.',
};

export function SettingsScreen({ onBack, onLoggedOut }: { onBack: () => void; onLoggedOut: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (v: SettingsView) => {
    setView(v);
    setUrl(v.hermesUrl);
    setKey('');
  };

  useEffect(() => {
    api.getSettings().then(apply).catch((e: Error) => setNotice(e.message));
    pushStatus().then(setPush).catch(() => setPush('unsupported'));
  }, []);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      apply(await api.saveSettings({ hermesUrl: url, hermesApiKey: key }));
      setNotice('Saved.');
    });
  };

  const keyPlaceholder = view?.apiKeySet ? `•••• ${view.apiKeyLast4} (${view.keySource})` : 'not set';

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center gap-2 border-b px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <h1 className="font-semibold">Settings</h1>
      </header>
      <main className="mx-auto max-w-lg space-y-8 p-4">
        <form onSubmit={save} className="space-y-4">
          <h2 className="font-medium">Hermes connection</h2>
          <div className="space-y-2">
            <Label htmlFor="url">Hermes URL {view && <span className="text-muted-foreground">({view.urlSource})</span>}</Label>
            <Input id="url" inputMode="url" autoCapitalize="off" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="key">API key</Label>
            <Input
              id="key"
              type="password"
              autoComplete="off"
              placeholder={keyPlaceholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void act(async () => setTest(await api.testConnection()))}
            >
              Test connection
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void act(async () => { apply(await api.resetSettings()); setNotice('Reset to env.'); })}
            >
              Reset to env
            </Button>
          </div>
          {test && (
            <p className="text-sm">{test.ok ? `✅ Connected (${test.models.join(', ') || 'no models'})` : `❌ ${test.error}`}</p>
          )}
        </form>

        <section className="space-y-3">
          <h2 className="font-medium">Notifications</h2>
          {push && <p className="text-sm text-muted-foreground">{PUSH_TEXT[push]}</p>}
          {push === 'disabled' && (
            <Button
              disabled={busy}
              onClick={() => void act(async () => { await enablePush(); setPush(await pushStatus()); })}
            >
              Enable notifications
            </Button>
          )}
        </section>

        <section className="space-y-3">
          <Button variant="outline" onClick={() => void act(async () => { await api.logout(); onLoggedOut(); })}>
            Log out
          </Button>
        </section>

        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Verify**

Run: `npm test -w client && npm run build -w client`
Expected: tests PASS; the build succeeds and `client/dist` contains `sw.js`, `manifest.webmanifest`, and the icons.

With the server, fake Hermes, and client dev server running (Task 11 Step 9), open Settings. Expected:
- The URL shows `http://localhost:8642 (env)` and the key placeholder shows "not set", or the last 4 characters if set.
- **Test connection** shows ✅.
- Saving a new URL shows `(settings)`; **Reset to env** reverts it.
- In desktop Chrome, **Enable notifications** prompts for permission, then shows "Notifications are on."
- **Log out** returns to the login screen.

Use browser devtools to confirm no response body contains the full API key.

- [ ] **Step 9: Commit**

```bash
git add client
git commit -m "feat(client): settings, web push subscription, PWA manifest and service worker"
```

---

### Task 13: Docker packaging + docs

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: `npm run build` (root), `server/dist/index.js`, `client/dist`. Env vars from the spec.

- [ ] **Step 1: Write the files**

`.dockerignore`:
```
**/node_modules
**/dist
data
.env
.git
docs
```

`Dockerfile`:
```dockerfile
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CLIENT_DIST=/app/client/dist \
    CRON_OUTPUT_DIR=/hermes/cron/output
WORKDIR /app/server
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist /app/client/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

`docker-compose.yml`:
```yaml
services:
  spooki:
    build: .
    container_name: spooki
    restart: unless-stopped
    env_file: .env
    # Hermes writes cron output as 0600 in 0700 dirs, so run as the Hermes user.
    user: "${HERMES_UID:-1000}:${HERMES_GID:-1000}"
    volumes:
      - ./data:/data
      - ${HERMES_CRON_OUTPUT:?set HERMES_CRON_OUTPUT in .env}:/hermes/cron/output:ro
    expose:
      - "3000"
    networks:
      - hermes
      - proxy

networks:
  hermes:
    external: true
    name: ${HERMES_NETWORK:?set HERMES_NETWORK in .env}
  proxy:
    external: true
    name: ${NPM_NETWORK:?set NPM_NETWORK in .env}
```

`.env.example`:
```bash
# --- app ---
APP_PASSWORD=change-me-to-something-long
HERMES_URL=http://hermes:8642
HERMES_API_KEY=
# Required for iOS push: Apple rejects placeholder subjects like mailto:admin@localhost
VAPID_SUBJECT=mailto:you@example.com
# HISTORY_WINDOW=40

# --- docker compose only ---
# Host path of Hermes' ~/.hermes/cron/output (bind-mounted read-only)
HERMES_CRON_OUTPUT=/srv/hermes/data/cron/output
# Docker networks of the Hermes container and of Nginx Proxy Manager
HERMES_NETWORK=hermes_default
NPM_NETWORK=npm_default
# UID/GID that owns the cron output files (ls -ln on the host)
HERMES_UID=1000
HERMES_GID=1000
```

`README.md`:
````markdown
# Spooki

A chat PWA for a self-hosted [Hermes Agent](https://hermes-agent.nousresearch.com/). It replaces the Telegram bot: you chat with streaming replies, and cron results arrive as push notifications.

## How it works

- The phone PWA talks to the spooki server over HTTPS, via Nginx Proxy Manager.
- The server calls Hermes' API server (`/v1/chat/completions`) over a shared Docker network.
- The server watches Hermes' cron output directory, saves new results as chat messages, and sends Web Push.

## Hermes setup

In Hermes' `~/.hermes/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<long random key>
API_SERVER_HOST=0.0.0.0   # reachable from other containers; do NOT publish the port
```

Restart the Hermes gateway. Set cron jobs to `deliver: local` so they stop going to Telegram. Spooki reads every run from the output directory anyway.

## Deploy

```bash
cp .env.example .env    # fill it in
mkdir -p data && sudo chown "$HERMES_UID:$HERMES_GID" data
docker compose up -d --build
```

Nginx Proxy Manager: add a proxy host `your.domain` → `spooki` port `3000`, request a Let's Encrypt certificate, and turn on Force SSL. No custom config is needed; spooki sends `X-Accel-Buffering: no` for streams.

Update with `git pull && docker compose up -d --build`.

## iPhone

1. Open `https://your.domain` in Safari and log in.
2. Tap Share → **Add to Home Screen**, then open Spooki from the Home Screen.
3. Go to Settings → **Enable notifications**.

## Development

```bash
npm install
npm test
APP_PASSWORD=pw DATA_DIR=/tmp/spooki CRON_OUTPUT_DIR=/tmp/spooki/cron HERMES_URL=http://localhost:8642 HERMES_API_KEY=... npx -w server tsx src/index.ts
npm run dev -w client    # http://localhost:5173, proxies /api to :3000
```

## Known limitations

- If Hermes asks for a dangerous-command **approval** during an API-server turn, spooki does not show it, and the turn waits. Configure Hermes approvals for the API server accordingly.
- There is one conversation. Voice, images, and multiple threads are planned.
````

- [ ] **Step 2: Build and smoke-test the image locally**

```bash
docker build -t spooki:test .
```
Expected: the build succeeds.

```bash
mkdir -p /tmp/spooki-docker/cron && docker run --rm -d --name spooki-test -p 3000:3000 -e APP_PASSWORD=pw -v /tmp/spooki-docker:/data -v /tmp/spooki-docker/cron:/hermes/cron/output:ro spooki:test
```
```bash
curl -s localhost:3000/api/health && curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/
```
Expected: `{"ok":true}` then `200`, and the index.html is served. Clean up:
```bash
docker rm -f spooki-test
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml .env.example README.md
git commit -m "chore: docker packaging and deployment docs"
```

---

### Task 14: VPS rollout and on-device verification (manual, with the user)

These steps run on the user's VPS and iPhone. Do each step with the user and record findings. Do not run commands on the VPS without the user's go-ahead.

- [ ] **Step 1: Verify the cron output format against real files**

On the VPS, find the cron output dir (inside the Hermes container: `~/.hermes/cron/output`) and its host path (`docker inspect <hermes> --format '{{json .Mounts}}'`). Also run `ls -ln` for the UID/GID.

Copy one real output file into `server/src/cron/__fixtures__/real.md`, redacting anything private. Add this test to `cron.test.ts`:
```ts
it('parses a real Hermes output file', () => {
  const r = parseCronFile('realjob/2026-09-25_07-00-01.md', fixture('real.md'));
  expect(r).not.toBeNull();
  expect(r!.jobName).not.toBe('realjob');
  expect(r!.content.length).toBeGreaterThan(0);
});
```
Run: `npm test -w server -- src/cron/cron.test.ts`. If it fails, adjust `parseCronFile` to the real format, keeping the existing tests green. Commit.

- [ ] **Step 2: Configure Hermes**

Set `API_SERVER_ENABLED`, `API_SERVER_KEY`, and `API_SERVER_HOST=0.0.0.0` (see README) and restart. Find the network name with `docker network ls`. From inside the NPM or another container on that network, `curl http://hermes:8642/v1/models -H "Authorization: Bearer <key>"` should return JSON.

- [ ] **Step 3: Deploy spooki**

Fill in `.env`, then `docker compose up -d --build`. Check `docker logs spooki`: it shows `spooki listening on :3000` and no `cron: … does not exist`. Add the NPM proxy host with Let's Encrypt. `curl https://your.domain/api/health` returns `{"ok":true}`.

- [ ] **Step 4: iPhone checklist**

- [ ] Log in in Safari, then Add to Home Screen and open from the icon. There is no Safari UI and the safe areas are respected.
- [ ] Settings → Test connection shows ✅.
- [ ] Enable notifications; iOS asks and it shows "Notifications are on."
- [ ] Send "what's the weather in Prague?": tool chips appear and the text streams.
- [ ] Send a long task, then immediately switch apps. A push arrives with the reply. Opening the app shows the reply.
- [ ] Trigger a cron job (ask Hermes to run one now). The push "Hermes · <job>" arrives and the message is labelled "⏰ Scheduled".
- [ ] Reply to the cron message. Hermes' answer shows it knew the cron content.
- [ ] Tapping a notification opens the app.
- [ ] Restart the container (`docker compose restart spooki`). There are no duplicate cron messages or pushes.

- [ ] **Step 5: Retire Telegram**

Once everything above passes, switch the remaining cron jobs to `deliver: local` and disable the Telegram platform in Hermes. Confirm with the user before changing their Hermes config.
