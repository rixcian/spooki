import type { HermesTarget, StreamChat } from '../hermes/client.js';
import { previewText, type PushSender } from '../push/sender.js';
import { buildHistory } from './history.js';
import type { Message, MessageStore } from './messages.js';

export type ChatStreamEvent =
  | { type: 'user'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
  | { type: 'done'; message: Message }
  | { type: 'error'; error: string; message: Message };

export type Listener = (e: ChatStreamEvent) => void;

export class BusyError extends Error {
  constructor() {
    super('A reply is already in progress');
  }
}

export class NothingToRetryError extends Error {
  constructor() {
    super('Nothing to retry');
  }
}

export interface RunHandle {
  finished: Promise<void>;
  detach(): void;
}

export interface ChatRunnerDeps {
  messages: MessageStore;
  getTarget: () => HermesTarget;
  stream: StreamChat;
  push: PushSender;
  historyWindow: number;
  log?: (...a: unknown[]) => void;
}

export class ChatRunner {
  private running = false;

  constructor(private d: ChatRunnerDeps) {}

  get busy(): boolean {
    return this.running;
  }

  send(text: string, listener: Listener): RunHandle {
    if (this.running) throw new BusyError();
    const user = this.d.messages.add({ role: 'user', source: 'chat', content: text });
    return this.run(listener, [{ type: 'user', message: user }]);
  }

  retry(listener: Listener): RunHandle {
    if (this.running) throw new BusyError();
    const last = this.d.messages.last();
    if (last?.role === 'assistant' && last.status === 'error') this.d.messages.delete(last.id);
    else if (last?.role !== 'user') throw new NothingToRetryError();
    return this.run(listener, []);
  }

  // The Hermes request is owned by the server, never by the HTTP client: Hermes interrupts the
  // agent when its caller disconnects, and iOS drops PWA connections whenever the app is hidden.
  private run(listener: Listener, initial: ChatStreamEvent[]): RunHandle {
    this.running = true;
    let attached: Listener | null = listener;
    const log = this.d.log ?? console.error;
    const emit = (e: ChatStreamEvent) => {
      try {
        attached?.(e);
      } catch (err) {
        log('chat: listener failed', err);
      }
    };
    initial.forEach(emit);

    const finished = (async () => {
      let text = '';
      let error: string | null = null;
      try {
        const history = buildHistory(this.d.messages.list(this.d.historyWindow));
        for await (const ev of this.d.stream(this.d.getTarget(), history)) {
          if (ev.type === 'delta') {
            text += ev.text;
            emit(ev);
          } else if (ev.type === 'tool') {
            emit(ev);
          } else if (ev.type === 'error') {
            error = ev.message;
            break;
          } else {
            break;
          }
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      const content = error
        ? text
          ? `${text}\n\n---\n⚠️ ${error}`
          : `⚠️ ${error}`
        : text || '(No response)';
      const saved = this.d.messages.add({
        role: 'assistant',
        source: 'chat',
        content,
        status: error ? 'error' : 'complete',
      });
      this.running = false;
      emit(error ? { type: 'error', error, message: saved } : { type: 'done', message: saved });

      if (!attached) {
        await this.d.push
          .sendToAll({ title: 'Hermes', body: previewText(saved.content), url: '/' })
          .catch((err) => log('chat: push failed', err));
      }
    })();

    return {
      finished,
      detach: () => {
        attached = null;
      },
    };
  }
}
