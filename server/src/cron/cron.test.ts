import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.js';
import { MessageStore } from '../chat/messages.js';
import { fakePush, waitFor } from '../test/helpers.js';
import { isCronOutputPath, parseCronFile } from './parse.js';
import { CronSeenStore } from './seen.js';
import { initialScan, processFile, startCronWatcher, startRescan, type CronDeps } from './watcher.js';

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
    dir = mkdtempSync(join(tmpdir(), 'hermik-cron-'));
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
    expect(deps.push.sent[0].title).toBe('Hermik · Morning briefing');
  });

  it('titles cron pushes with the current bot name', async () => {
    const abs = write('a1b2c3/2026-09-25_07-00-01.md', fixture('response.md'));
    await processFile({ ...deps, botName: () => 'Mimi' }, abs);
    expect(deps.push.sent[0].title).toBe('Mimi · Morning briefing');
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
    await waitFor(() => messages.list().length === 1, 8000); // fs events can lag under load
    expect(deps.push.sent).toHaveLength(1);
  });

  it('periodic rescan delivers files without any fs watcher', async () => {
    await initialScan(deps); // sets the baseline, as on a first start
    write('a1b2c3/2026-09-25_09-00-00.md', fixture('response.md'));
    const stop = startRescan(deps, 20);
    try {
      await waitFor(() => messages.list().length === 1);
    } finally {
      stop();
    }
    expect(deps.push.sent).toHaveLength(1);
  });

  it('is a no-op when the directory does not exist', async () => {
    const watcher = await startCronWatcher({ ...deps, dir: join(dir, 'missing') });
    await watcher.close();
  });
});
