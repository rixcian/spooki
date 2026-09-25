import type { Message } from './messages.js';

export interface HermesMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildHistory(messages: Message[]): HermesMessage[] {
  return messages
    .filter((m) => m.status === 'complete')
    .map((m) => ({
      role: m.role,
      content: m.source === 'cron' ? `[Scheduled: ${m.cronJob ?? 'cron'}]\n\n${m.content}` : m.content,
    }));
}
