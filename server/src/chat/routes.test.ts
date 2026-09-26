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

  it('POST /chat/stop stops a running reply', async () => {
    const gate = deferred();
    const { app, runner } = makeApp([{ type: 'done' }], gate.promise);
    expect(await (await post(app, '/chat/stop', {})).json()).toEqual({ stopped: false });
    const res = await post(app, '/chat', { text: 'hi' });
    expect(await (await post(app, '/chat/stop', {})).json()).toEqual({ stopped: true });
    const frames = parseSseText(await res.text());
    expect(frames.map((f) => f.event)).toEqual(['user', 'done']);
    expect(runner.busy).toBe(false);
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
