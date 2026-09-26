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

  app.post('/chat/stop', (c) => c.json({ stopped: runner.stop() }));

  return app;
}
