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

  it('aborting the signal ends the stream (Hermes interrupts the agent on disconnect)', async () => {
    const fake = await startFakeHermes((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk('working'));
    });
    close = fake.close;
    const controller = new AbortController();
    const events: HermesEvent[] = [];
    for await (const e of streamChat({ url: fake.url, apiKey: 'k' }, [], controller.signal)) {
      events.push(e);
      if (e.type === 'delta') controller.abort();
    }
    expect(events[0]).toEqual({ type: 'delta', text: 'working' });
    expect(events.at(-1)?.type).toBe('error');
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
