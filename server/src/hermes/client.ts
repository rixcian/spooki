import type { HermesMessage } from '../chat/history.js';
import { createLogger, describeError } from '../log.js';
import { parseSse } from './sse.js';

const log = createLogger('hermes');

export interface HermesTarget {
  url: string;
  apiKey: string;
}

export type HermesEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

// Aborting `signal` closes the HTTP request, which makes Hermes interrupt the agent.
export type StreamChat = (
  target: HermesTarget,
  messages: HermesMessage[],
  signal?: AbortSignal,
) => AsyncGenerator<HermesEvent>;

export type ListModelsResult = { ok: true; models: string[] } | { ok: false; error: string };
export type ListModels = (target: HermesTarget) => Promise<ListModelsResult>;

const baseUrl = (url: string) => url.replace(/\/+$/, '');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const HINTS: Record<number, string> = {
  401: 'check the API key',
  403: 'check the API key',
  404: 'is this the Hermes API server URL?',
};

function httpError(status: number, body = ''): string {
  const hint = HINTS[status] ? ` - ${HINTS[status]}` : '';
  const detail = body ? `: ${body.slice(0, 200)}` : '';
  return `HTTP ${status} from Hermes${hint}${detail}`;
}

export const streamChat: StreamChat = async function* (target, messages, signal) {
  const url = `${baseUrl(target.url)}/v1/chat/completions`;
  const started = Date.now();
  let chars = 0;
  log.info('chat request', { url, messages: messages.length });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify({ model: 'hermes-agent', messages, stream: true }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    const message = `Cannot reach Hermes at ${baseUrl(target.url)}: ${describeError(err)}`;
    log.error('chat request failed', { url, error: message });
    yield { type: 'error', message };
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const message = httpError(res.status, text);
    log.error('chat request rejected', { url, status: res.status, body: text.slice(0, 200) });
    yield { type: 'error', message };
    return;
  }
  try {
    for await (const frame of parseSse(res.body)) {
      if (frame.data === '[DONE]') {
        log.info('chat reply done', { chars, ms: Date.now() - started });
        yield { type: 'done' };
        return;
      }
      if (frame.event === 'hermes.tool.progress') {
        const p = safeJson(frame.data);
        if (p && typeof p.tool === 'string') {
          yield {
            type: 'tool',
            phase: p.status === 'completed' ? 'completed' : 'started',
            id: String(p.toolCallId ?? ''),
            name: p.tool,
            label: p.label,
            emoji: p.emoji,
          };
        }
        continue;
      }
      if (frame.event !== null) continue; // hermes.status, approval.request, …
      const parsed = safeJson(frame.data);
      const choice = parsed?.choices?.[0];
      if (!choice) continue;
      const content = choice.delta?.content;
      if (typeof content === 'string' && content) {
        chars += content.length;
        yield { type: 'delta', text: content };
      }
      if (choice.finish_reason && choice.finish_reason !== 'stop') {
        const message = parsed.error?.message ?? `Hermes finished with reason "${choice.finish_reason}"`;
        log.error('chat reply failed', { finishReason: choice.finish_reason, error: message });
        yield { type: 'error', message };
        return;
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    const message = `Stream broke: ${describeError(err)}`;
    log.error('chat stream broke', { chars, ms: Date.now() - started, error: message });
    yield { type: 'error', message };
    return;
  }
  if (signal?.aborted) return;
  log.error('chat stream ended without [DONE]', { chars, ms: Date.now() - started });
  yield { type: 'error', message: 'Stream ended unexpectedly' };
};

export const listModels: ListModels = async (target) => {
  const url = `${baseUrl(target.url)}/v1/models`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${target.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.warn('connection test rejected', { url, status: res.status });
      return { ok: false, error: httpError(res.status) };
    }
    const body = (await res.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id);
    log.info('connection test ok', { url, models: models.join(',') });
    return { ok: true, models };
  } catch (err) {
    const error = `Cannot reach Hermes at ${baseUrl(target.url)}: ${describeError(err)}`;
    log.warn('connection test failed', { url, error });
    return { ok: false, error };
  }
};
