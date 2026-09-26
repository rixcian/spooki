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
