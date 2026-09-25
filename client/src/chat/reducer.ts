import type { Message } from '@/lib/api';

export interface ToolChip {
  id: string;
  name: string;
  label?: string;
  emoji?: string;
  done: boolean;
}

export interface ChatState {
  messages: Message[];
  streaming: { text: string; tools: ToolChip[] } | null;
  sending: boolean;
  remoteBusy: boolean;
  error: string | null;
}

export type ChatAction =
  | { type: 'loaded'; messages: Message[]; busy: boolean }
  | { type: 'send'; text: string }
  | { type: 'user'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed'; id: string; name: string; label?: string; emoji?: string }
  | { type: 'finished'; message: Message }
  | { type: 'failed'; error: string }
  | { type: 'detached' }
  | { type: 'retry' };

export const initialChatState: ChatState = {
  messages: [],
  streaming: null,
  sending: false,
  remoteBusy: false,
  error: null,
};

const withoutOptimistic = (messages: Message[]) => messages.filter((m) => m.id > 0);

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded':
      return { ...state, messages: action.messages, remoteBusy: action.busy };
    case 'send':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: -Date.now(),
            role: 'user',
            source: 'chat',
            content: action.text,
            status: 'complete',
            cronJob: null,
            createdAt: new Date().toISOString(),
          },
        ],
        sending: true,
        streaming: { text: '', tools: [] },
        error: null,
      };
    case 'user':
      return { ...state, messages: [...withoutOptimistic(state.messages), action.message] };
    case 'delta':
      if (!state.streaming) return state;
      return { ...state, streaming: { ...state.streaming, text: state.streaming.text + action.text } };
    case 'tool': {
      if (!state.streaming) return state;
      const tools = state.streaming.tools;
      const next =
        action.phase === 'started'
          ? tools.some((t) => t.id === action.id)
            ? tools
            : [...tools, { id: action.id, name: action.name, label: action.label, emoji: action.emoji, done: false }]
          : tools.map((t) => (t.id === action.id ? { ...t, done: true } : t));
      return { ...state, streaming: { ...state.streaming, tools: next } };
    }
    case 'finished':
      return {
        ...state,
        messages: [...withoutOptimistic(state.messages), action.message],
        streaming: null,
        sending: false,
        remoteBusy: false,
      };
    case 'failed':
      return { ...state, messages: withoutOptimistic(state.messages), streaming: null, sending: false, error: action.error };
    case 'detached':
      return { ...state, streaming: null, sending: false, remoteBusy: true };
    case 'retry': {
      const last = state.messages.at(-1);
      const messages =
        last?.role === 'assistant' && last.status === 'error' ? state.messages.slice(0, -1) : state.messages;
      return { ...state, messages, sending: true, streaming: { text: '', tools: [] }, error: null };
    }
  }
}
