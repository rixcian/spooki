import { describe, it, expect } from 'vitest';
import type { Message } from '@/lib/api';
import { chatReducer, initialChatState, isEmptyChat, restoreChat, snapshotChat, type ChatAction, type ChatState } from './reducer';

const msg = (id: number, over: Partial<Message> = {}): Message => ({
  id, role: 'assistant', source: 'chat', content: `m${id}`, status: 'complete', cronJob: null, createdAt: '', ...over,
});

const run = (...actions: ChatAction[]): ChatState =>
  actions.reduce(chatReducer, initialChatState);

describe('chat snapshot', () => {
  it('restores a loaded chat instantly, dropping optimistic and in-flight state', () => {
    const s = run({ type: 'loaded', messages: [msg(1)], busy: false }, { type: 'send', text: 'hi' }, { type: 'delta', text: 'He' });
    const restored = restoreChat(snapshotChat(s));
    expect(restored.loaded).toBe(true);
    expect(restored.messages.map((m) => m.id)).toEqual([1]);
    expect(restored.streaming).toBeNull();
    expect(restored.sending).toBe(false);
    expect(restored.remoteBusy).toBe(true); // the server is still working; polling picks it up
  });

  it('has nothing to snapshot before the first load', () => {
    expect(snapshotChat(initialChatState)).toBeNull();
    expect(restoreChat(null)).toEqual(initialChatState);
  });
});

describe('chatReducer', () => {
  it('loads history and remote busy flag', () => {
    const s = run({ type: 'loaded', messages: [msg(1)], busy: true });
    expect(s.messages).toEqual([msg(1)]);
    expect(s.remoteBusy).toBe(true);
    expect(s.loaded).toBe(true);
    expect(initialChatState.loaded).toBe(false);
  });

  it('is empty only once loaded with no messages and nothing in flight', () => {
    expect(isEmptyChat(initialChatState)).toBe(false); // still loading: show neither state
    expect(isEmptyChat(run({ type: 'loaded', messages: [], busy: false }))).toBe(true);
    expect(isEmptyChat(run({ type: 'loaded', messages: [], busy: true }))).toBe(false);
    expect(isEmptyChat(run({ type: 'loaded', messages: [], busy: false }, { type: 'send', text: 'hi' }))).toBe(false);
    expect(isEmptyChat(run({ type: 'loaded', messages: [msg(1)], busy: false }))).toBe(false);
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
