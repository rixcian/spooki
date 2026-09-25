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
    expect(push.sent).toEqual([{ title: 'Hermik', body: 'Background answer', url: '/' }]);
  });

  it('titles background pushes with the current bot name', async () => {
    const push = fakePush();
    const runner = new ChatRunner({
      messages, push, historyWindow: 40, getTarget: () => ({ url: '', apiKey: '' }), log: () => {},
      stream: fakeStream([{ type: 'delta', text: 'hi' }, { type: 'done' }]), botName: () => 'Mimi',
    });
    const handle = runner.send('q', () => {});
    handle.detach();
    await handle.finished;
    expect(push.sent[0].title).toBe('Mimi');
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

  it('stop() interrupts Hermes, keeps the partial text and skips the push', async () => {
    const push = fakePush();
    let seenSignal: AbortSignal | undefined;
    const runner = new ChatRunner({
      messages, push, historyWindow: 40, getTarget: () => ({ url: '', apiKey: '' }), log: () => {},
      stream: async function* (_t, _m, signal) {
        seenSignal = signal;
        yield { type: 'delta', text: 'Half an ans' };
        await new Promise(() => {}); // Hermes keeps working until interrupted
      },
    });
    const events: ChatStreamEvent[] = [];
    const handle = runner.send('q', (e) => events.push(e));
    handle.detach();
    await new Promise((r) => setTimeout(r, 0));
    expect(runner.stop()).toBe(true);
    await handle.finished;
    expect(seenSignal?.aborted).toBe(true);
    expect(messages.last()).toMatchObject({ role: 'assistant', status: 'complete', content: 'Half an ans\n\n_Stopped_' });
    expect(runner.busy).toBe(false);
    expect(push.sent).toEqual([]);
  });

  it('stop() emits done to an attached listener; returns false when idle', async () => {
    const gate = deferred();
    const { runner } = makeRunner([{ type: 'done' }], gate.promise);
    expect(runner.stop()).toBe(false);
    const events: ChatStreamEvent[] = [];
    const handle = runner.send('q', (e) => events.push(e));
    runner.stop();
    await handle.finished;
    expect(events.map((e) => e.type)).toEqual(['user', 'done']);
    expect(messages.last()?.content).toBe('_Stopped_');
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
