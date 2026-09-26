import { accessSync, constants, mkdirSync, statSync } from 'node:fs';
import { describeError } from './log.js';

/**
 * Checks that the data directory exists and is writable, and otherwise explains exactly how
 * to fix it - the usual cause is a bind-mounted host folder that Docker created as root.
 */
export function dataDirProblem(dir: string): string | null {
  const uid = process.getuid?.() ?? -1;
  const gid = process.getgid?.() ?? -1;
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return null;
  } catch (err) {
    let owner = 'unknown';
    try {
      const st = statSync(dir);
      owner = `${st.uid}:${st.gid}`;
    } catch {
      // the directory itself could not be created
    }
    return [
      `${dir} is not writable (${describeError(err)}).`,
      `Spooki runs as uid ${uid}:${gid}, but the directory is owned by uid ${owner}.`,
      `Fix it on the host: sudo chown -R ${uid}:${gid} <host path mounted at ${dir}>`,
    ].join(' ');
  }
}
