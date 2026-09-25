# Hermik

A chat PWA for a self-hosted [Hermes Agent](https://hermes-agent.nousresearch.com/). It replaces the Telegram bot: you chat with streaming replies, and cron results arrive as push notifications.

## How it works

- The phone PWA talks to the hermik server over HTTPS, via Nginx Proxy Manager.
- The server calls Hermes' API server (`/v1/chat/completions`) over a shared Docker network.
- The server watches Hermes' cron output directory, saves new results as chat messages, and sends Web Push.

## Hermes setup

In Hermes' `~/.hermes/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<long random key>
API_SERVER_HOST=0.0.0.0   # reachable from other containers; do NOT publish the port
```

Restart the Hermes gateway. Set cron jobs to `deliver: local` so they stop going to Telegram. Hermik reads every run from the output directory anyway.

## Deploy

```bash
cp .env.example .env    # fill it in
mkdir -p data && sudo chown "$HERMES_UID:$HERMES_GID" data
docker compose up -d --build
```

Nginx Proxy Manager: add a proxy host `your.domain` → `hermik` port `3000`, request a Let's Encrypt certificate, and turn on Force SSL. No custom config is needed; hermik sends `X-Accel-Buffering: no` for streams.

Update with `git pull && docker compose up -d --build`.

## iPhone

1. Open `https://your.domain` in Safari and log in.
2. Tap Share → **Add to Home Screen**, then open Hermik from the Home Screen.
3. Go to Settings → **Enable notifications**.

## Development

```bash
npm install
npm test
APP_PASSWORD=pw DATA_DIR=/tmp/hermik CRON_OUTPUT_DIR=/tmp/hermik/cron HERMES_URL=http://localhost:8642 HERMES_API_KEY=... npx -w server tsx src/index.ts
npm run dev -w client    # http://localhost:5173, proxies /api to :3000
```

## Known limitations

- If Hermes asks for a dangerous-command **approval** during an API-server turn, Hermik does not show it, and the turn waits. Configure Hermes approvals for the API server accordingly.
- There is one conversation. Voice, images, and multiple threads are planned.
