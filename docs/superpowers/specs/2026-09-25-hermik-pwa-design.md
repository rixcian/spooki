# Hermik — Hermes Agent chat PWA

**Date:** 2026-09-25
**Status:** Approved design, pending implementation plan

## Goal

Replace the Telegram bot as the way to talk to a self-hosted Nous Research
Hermes Agent. Hermik is a single-user chat PWA installed on an iPhone Home
Screen. It supports:

1. Plain text chat with streaming replies.
2. Proactive messages from Hermes (cron job results) delivered as push
   notifications and shown in the chat.

Out of scope for v1 (planned later, not designed here): voice messages,
photos/files, multiple conversations/threads.

## Why a PWA

There is no paid Apple Developer account. A native app would need to be
reinstalled from Xcode every 7 days and could not use APNs. A Home Screen
PWA on iOS 16.4+ gets Web Push for free, never expires, and deploys with
the server.

## Architecture

```
iPhone (Home Screen PWA)
   │ HTTPS (Nginx Proxy Manager, Let's Encrypt)
   ▼
hermik container (one Node process, port 3000)
   ├─ serves the built PWA (static files)
   ├─ /api/auth/*      login / logout
   ├─ /api/chat        proxies to Hermes, streams SSE back
   ├─ /api/messages    chat history from SQLite
   ├─ /api/settings    Hermes URL / key override
   ├─ /api/push/*      VAPID public key, subscribe / unsubscribe
   └─ cron watcher     watches Hermes cron output dir → DB + Web Push
   │ shared Docker network
   ▼
hermes container (API server, e.g. http://hermes:8642)
```

### Stack

- **Client:** Vite + React + TypeScript, Tailwind CSS, coss ui components.
  A hand-written service worker handles push and notification clicks.
- **Server:** Node + Hono + TypeScript, SQLite (better-sqlite3), `web-push`,
  argon2 for password hashing.
- **Tests:** Vitest.
- **Repo layout:** one repo with `client/` and `server/`. The server serves
  the client build in production.

## Hermes integration

Hermes' built-in API server (`API_SERVER_ENABLED=true`, default port 8642)
exposes an OpenAI-compatible `POST /v1/chat/completions` endpoint with
bearer-token auth.

- Hermik calls it in **stateless mode**: every request sends the last 40
  messages from the SQLite history as the `messages` array, with
  `stream: true`. Hermik's DB is the source of truth for the conversation.
- Cron messages are sent to Hermes as `assistant` turns, prefixed with
  `[Scheduled: <job name>]`, so Hermes has context when the user replies to
  one.
- Streamed `chat.completion.chunk` deltas and `hermes.tool.progress` events
  (`tool.started`, `tool.completed`) are forwarded to the client.
- **Connection test:** `GET /v1/models` with the configured key.

## Data model (SQLite)

| Table | Columns |
|-------|---------|
| `messages` | `id`, `role` (`user` \| `assistant`), `source` (`chat` \| `cron`), `content`, `status` (`complete` \| `error`), `cron_job` (job name for cron messages), `created_at` |
| `cron_seen` | `path` (unique), `seen_at` |
| `push_subscriptions` | `id`, `endpoint` (unique), `keys_json`, `created_at` |
| `settings` | `key` (unique), `value`. Used for `hermes_url` and `hermes_api_key` overrides |
| `sessions` | `id` (random 256-bit token hash), `created_at`, `expires_at` |

## Chat flow

1. The client POSTs `/api/chat` with `{ text }`.
2. The server saves the user message, builds the history window, and calls
   Hermes with `stream: true`.
3. The server responds to the client as SSE with events:
   - `user` `{ message }` — the saved user message
   - `delta` `{ text }` — a text chunk
   - `tool` `{ phase: "started" | "completed", name, preview?, error? }`
   - `done` `{ message }` — the saved assistant message
   - `error` `{ message }`
4. On completion the server saves the assistant message.

**Background resilience:** iOS drops the PWA's connection when the user
switches apps. The Hermes request runs independently of the client
connection: it is never aborted when the client disconnects. When the reply
finishes and the client stream is no longer open, the server sends a Web
Push with the reply's start (truncated to about 150 characters). On reopen,
the client reloads `/api/messages`, which also returns `busy`. While `busy` is
true the client shows "Hermes is still working…" and polls every 3 seconds.

On the very first start, existing cron output files are recorded as seen
without being delivered, so old history isn't replayed as notifications.

Only one chat request runs at a time. A second send while one is in flight
returns `409`, and the client disables the send button while waiting.

## UI

- **Login screen:** a password field.
- **Chat screen:** Markdown-rendered messages, a "thinking" indicator, tool
  chips (e.g. "🔧 web_search…"), auto-scroll to bottom, and a composer.
  Cron messages have a subtle "Scheduled: <job>" label. Failed replies show
  an error bubble with **Retry**. Retry calls `POST /api/chat/retry`, which
  deletes the failed assistant message and re-runs Hermes for the existing
  last user message, without saving a duplicate.
- **Settings screen:**
  - Hermes URL (prefilled with the effective value) and API key
    (write-only; shows only "set / not set" and the last 4 characters).
  - **Test connection** shows ✅ or the error.
  - **Reset to env** clears the overrides.
  - **Enable notifications** subscribes to push. iOS requires a user
    gesture for this.
  - **Logout.**
- The PWA manifest, icons, and `display: standalone` config make it
  installable to the Home Screen.

## Cron → chat

- In Hermes, cron jobs are configured with `deliver: local`, so output is
  written under `~/.hermes/cron/output/`.
- That directory is mounted **read-only** into the hermik container at
  `CRON_OUTPUT_DIR` (default `/hermes/cron/output`).
- The watcher (chokidar, plus a full scan on startup) handles each new
  file whose path is not in `cron_seen`: it parses the job name and content,
  saves a `cron` message, records the path, and sends a Web Push.
- A path that is already in `cron_seen` is skipped. This makes restarts
  safe.
- **First implementation task:** inspect the real output file layout and
  format on the VPS and write the parser against it, with a fixture.

## Push

- VAPID keys are generated on first start and stored in the `./data`
  volume. They can also be supplied via `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- The service worker shows the notification and focuses or opens the app
  on click.
- A subscription that returns `404` or `410` from the push service is
  deleted.

## Auth

- Single user. `APP_PASSWORD` is set in env, hashed with argon2 in memory
  at startup, and never persisted in plain text.
- `POST /api/auth/login` sets a session cookie: `HttpOnly`, `Secure`,
  `SameSite=Strict`, valid 90 days. Only a hash of the token is stored in
  `sessions`.
- `POST /api/auth/logout` deletes the session.
- Every `/api/*` route except login requires a valid session. Static PWA
  files are public.
- Login is rate-limited to 5 failed attempts per minute per client IP. The
  IP is taken from `X-Forwarded-For` (NPM is a trusted proxy).
- The Hermes API key never reaches the browser.

## Configuration (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | HTTP port |
| `APP_PASSWORD` | required | Login password |
| `HERMES_URL` | `http://hermes:8642` | Default Hermes base URL |
| `HERMES_API_KEY` | — | Default Hermes bearer key |
| `CRON_OUTPUT_DIR` | `/hermes/cron/output` | Watched cron output directory |
| `DATA_DIR` | `/data` | SQLite DB + generated VAPID keys |
| `VAPID_*` | generated | Optional explicit VAPID keys and subject |
| `HISTORY_WINDOW` | `40` | Messages sent to Hermes per request |

Precedence for the Hermes URL and key: **settings table > env**.

## Deployment

- A multi-stage `Dockerfile`: build the client, build the server, then a
  slim Node runtime.
- `docker-compose.yml`:
  - The hermik service joins the external Docker networks that Hermes and
    Nginx Proxy Manager use.
  - `./data:/data`.
  - The Hermes data volume/path is mounted read-only at
    `/hermes/cron/output`.
  - `restart: unless-stopped`.
- **HTTPS:** an NPM proxy host → `hermik:3000` with a Let's Encrypt
  certificate. The server sets `X-Accel-Buffering: no` on SSE responses so
  nginx does not buffer them. No custom NPM config is needed.
- **Deploy command:** `git pull && docker compose up -d --build`.

## Error handling

- **Hermes unreachable or non-2xx:** send an `error` SSE event, save the
  assistant message with `status=error`, and the client shows Retry.
- **Stream breaks mid-reply:** save the partial content with
  `status=error`. The client shows it with Retry.
- **Push send fails:** log it and prune dead subscriptions. Push failures
  never break chat.
- **Cron file parse fails:** log it and still mark the file seen so it
  isn't retried forever. Save the raw content as a message.

## Testing

- **Vitest, server:**
  - Streaming proxy against a fake Hermes SSE server: deltas, tool events,
    done.
  - A client disconnect mid-stream still saves the reply and triggers push.
  - History window building, including the cron prefix.
  - Cron watcher dedupe across restarts, using a fixture file.
  - Auth: login, cookie, rate limit, and protected routes.
  - Settings precedence (settings table > env) and key masking.
- **Manual:** on an iPhone, install to Home Screen, log in, chat, leave the
  app mid-reply (push arrives), trigger a cron job (push + message), then
  tap the notification (the app opens).
