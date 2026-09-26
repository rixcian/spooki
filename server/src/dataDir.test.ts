import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDirProblem } from './dataDir.js';

describe('dataDirProblem', () => {
  it('accepts a writable directory, creating it if needed', () => {
    expect(dataDirProblem(join(mkdtempSync(join(tmpdir(), 'spooki-')), 'nested'))).toBeNull();
  });

  // Root can write anywhere, so this can only be checked as a normal user.
  it.skipIf(process.getuid?.() === 0)('explains an unwritable directory with the fix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spooki-'));
    chmodSync(dir, 0o555);
    const problem = dataDirProblem(dir)!;
    chmodSync(dir, 0o755);
    expect(problem).toContain(`${dir} is not writable`);
    expect(problem).toMatch(/runs as uid \d+:\d+/);
    expect(problem).toMatch(/owned by uid \d+:\d+/);
    expect(problem).toMatch(/sudo chown -R \d+:\d+ <host path mounted at /);
  });
});
