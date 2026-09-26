import { afterEach, describe, expect, it } from 'vitest';
import { createLogger, describeError, parseLogLevel, setLogLevel, setLogSink } from './log.js';

let lines: string[] = [];
afterEach(() => {
  setLogSink(undefined);
  setLogLevel('silent');
});

function capture(level: Parameters<typeof setLogLevel>[0]) {
  lines = [];
  setLogLevel(level);
  setLogSink((line) => lines.push(line));
}

describe('createLogger', () => {
  it('writes timestamped, scoped lines with key=value fields', () => {
    capture('info');
    createLogger('hermes').warn('request failed', { url: 'http://h:1', status: 502, error: 'bad gateway' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z WARN  hermes: request failed url=http:\/\/h:1 status=502 error="bad gateway"$/);
  });

  it('respects the level', () => {
    capture('warn');
    const log = createLogger('x');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines.map((l) => l.split(' ')[1])).toEqual(['WARN', 'ERROR']);
  });

  it('skips undefined fields', () => {
    capture('debug');
    createLogger('x').info('m', { a: 1, b: undefined });
    expect(lines[0]).toMatch(/x: m a=1$/);
  });
});

describe('parseLogLevel', () => {
  it('defaults to info', () => {
    expect(parseLogLevel(undefined)).toBe('info');
    expect(parseLogLevel('DEBUG')).toBe('debug');
    expect(parseLogLevel('nope')).toBe('info');
  });
});

describe('describeError', () => {
  it('includes the cause behind a generic fetch failure', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.1.32:8642'), { code: 'ECONNREFUSED' });
    const err = new TypeError('fetch failed', { cause });
    expect(describeError(err)).toBe('fetch failed: connect ECONNREFUSED 10.0.1.32:8642');
  });

  it('lists every attempt when a host resolved to several addresses', () => {
    const cause = Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:80'), new Error('connect ECONNREFUSED 127.0.0.1:80')], ''), { code: 'ECONNREFUSED' });
    expect(describeError(new TypeError('fetch failed', { cause }))).toBe(
      'fetch failed: connect ECONNREFUSED ::1:80; connect ECONNREFUSED 127.0.0.1:80',
    );
  });

  it('uses the code when the cause has no message', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    expect(describeError(err)).toBe('fetch failed: ENOTFOUND');
  });

  it('explains timeouts', () => {
    const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(describeError(err)).toBe('timed out');
  });

  it('handles non-errors', () => {
    expect(describeError('boom')).toBe('boom');
  });
});
