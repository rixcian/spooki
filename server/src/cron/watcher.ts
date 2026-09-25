import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { watch } from 'chokidar';
import type { MessageStore } from '../chat/messages.js';
import { previewText, type PushSender } from '../push/sender.js';
import { isCronOutputPath, parseCronFile } from './parse.js';
import type { CronSeenStore } from './seen.js';

export interface CronDeps {
  dir: string;
  seen: CronSeenStore;
  messages: MessageStore;
  push: PushSender;
  log?: (...a: unknown[]) => void;
}

// Marker row: not a valid output path, so it can never collide with a real file.
const BASELINE = '.baseline';

const toRel = (dir: string, abs: string) => relative(dir, abs).split(sep).join('/');

export async function processFile(d: CronDeps, absPath: string): Promise<void> {
  const log = d.log ?? console.error;
  const rel = toRel(d.dir, absPath);
  if (!isCronOutputPath(rel) || d.seen.has(rel)) return;
  d.seen.add(rel); // claim synchronously so concurrent add/scan events can't double-deliver

  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch (err) {
    d.seen.remove(rel); // unreadable now (e.g. permissions) — retry on next scan
    log('cron: cannot read', rel, err);
    return;
  }

  let result: ReturnType<typeof parseCronFile>;
  try {
    result = parseCronFile(rel, text);
  } catch (err) {
    log('cron: parse failed, delivering raw', rel, err);
    const jobId = rel.split('/')[0];
    result = { jobId, jobName: jobId, content: text };
  }
  if (!result) return;

  const message = d.messages.add({ role: 'assistant', source: 'cron', content: result.content, cronJob: result.jobName });
  await d.push
    .sendToAll({ title: `Hermik · ${result.jobName}`, body: previewText(message.content), url: '/' })
    .catch((err) => log('cron: push failed', err));
}

async function listOutputFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const job of await readdir(dir, { withFileTypes: true })) {
    if (!job.isDirectory() || job.name.startsWith('.')) continue;
    for (const f of await readdir(join(dir, job.name))) {
      if (f.endsWith('.md') && !f.startsWith('.')) files.push(join(dir, job.name, f));
    }
  }
  return files.sort();
}

export async function initialScan(d: CronDeps): Promise<void> {
  const files = await listOutputFiles(d.dir);
  if (!d.seen.has(BASELINE)) {
    // First run ever: don't replay months of history as notifications.
    for (const f of files) {
      const rel = toRel(d.dir, f);
      if (isCronOutputPath(rel)) d.seen.add(rel);
    }
    d.seen.add(BASELINE);
    return;
  }
  for (const f of files) await processFile(d, f);
}

export async function startCronWatcher(d: CronDeps): Promise<{ close(): Promise<void> }> {
  const log = d.log ?? console.error;
  if (!existsSync(d.dir)) {
    log(`cron: ${d.dir} does not exist; cron messages are disabled`);
    return { close: async () => {} };
  }
  await initialScan(d);
  const watcher = watch(d.dir, {
    ignoreInitial: true,
    depth: 2,
    ignored: (p: string) => p !== d.dir && basename(p).startsWith('.'),
  });
  watcher.on('add', (p: string) => {
    void processFile(d, p);
  });
  watcher.on('error', (err: unknown) => log('cron: watcher error', err));
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  return { close: () => watcher.close() };
}
