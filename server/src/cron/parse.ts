export interface CronResult {
  jobId: string;
  jobName: string;
  content: string;
}

// Hermes writes ~/.hermes/cron/output/{job_id}/{YYYY-MM-DD_HH-MM-SS}.md (cron/jobs.py save_job_output).
const FILE_RE = /^([^/]+)\/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.md$/;
const RESPONSE_HEADING = '\n## Response\n';

export function isCronOutputPath(relPath: string): boolean {
  return FILE_RE.test(relPath);
}

export function parseCronFile(relPath: string, text: string): CronResult | null {
  const match = FILE_RE.exec(relPath);
  if (!match) return null;
  const jobId = match[1];
  const jobName = /^# Cron Job: (.+)$/m.exec(text)?.[1].trim() || jobId;

  const at = text.indexOf(RESPONSE_HEADING);
  if (at !== -1) {
    const response = text.slice(at + RESPONSE_HEADING.length).trim();
    if (!response || response === '(No response generated)' || response.startsWith('[SILENT]')) return null;
    return { jobId, jobName, content: response };
  }

  // No agent response: script-gate skips are noise; blocked/error docs are worth seeing.
  if (text.includes('wakeAgent=false')) return null;
  const body = text.replace(/^# Cron Job: .+$/m, '').trim();
  return body ? { jobId, jobName, content: body } : null;
}
