import type { HermesMessage } from '../chat/history.js';
import type { HermesEvent, HermesTarget, StreamChat } from '../hermes/client.js';
import type { PushPayload, PushSender } from '../push/sender.js';

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

export function fakeStream(events: HermesEvent[], gate?: Promise<void>) {
  const calls: { target: HermesTarget; messages: HermesMessage[] }[] = [];
  const fn: StreamChat = async function* (target, messages, signal) {
    calls.push({ target, messages });
    if (gate) await Promise.race([gate, new Promise((r) => signal?.addEventListener('abort', r))]);
    if (signal?.aborted) return;
    for (const e of events) yield e;
  };
  return Object.assign(fn, { calls });
}

export function fakePush(): PushSender & { sent: PushPayload[] } {
  const sent: PushPayload[] = [];
  return { sent, sendToAll: async (p) => { sent.push(p); } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSseText(text: string): { event: string; data: any }[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? 'null';
      return { event, data: JSON.parse(data) };
    });
}

export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
