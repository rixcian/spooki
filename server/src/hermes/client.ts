import type { HermesMessage } from '../chat/history.js';
import { parseSse } from './sse.js';

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
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const streamChat: StreamChat = async function* (target, messages, signal) {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(target.url)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify({ model: 'hermes-agent', messages, stream: true }),
      signal,
    });
  } catch (err) {
    yield { type: 'error', message: `Cannot reach Hermes: ${errMsg(err)}` };
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    yield { type: 'error', message: `Hermes HTTP ${res.status}: ${text.slice(0, 200)}` };
    return;
  }
  try {
    for await (const frame of parseSse(res.body)) {
      if (frame.data === '[DONE]') {
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
      if (typeof content === 'string' && content) yield { type: 'delta', text: content };
      if (choice.finish_reason && choice.finish_reason !== 'stop') {
        yield { type: 'error', message: parsed.error?.message ?? `Hermes finished with reason "${choice.finish_reason}"` };
        return;
      }
    }
  } catch (err) {
    yield { type: 'error', message: `Stream broke: ${errMsg(err)}` };
    return;
  }
  yield { type: 'error', message: 'Stream ended unexpectedly' };
};

export const listModels: ListModels = async (target) => {
  try {
    const res = await fetch(`${baseUrl(target.url)}/v1/models`, {
      headers: { authorization: `Bearer ${target.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, models: (body.data ?? []).map((m) => m.id) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
};
