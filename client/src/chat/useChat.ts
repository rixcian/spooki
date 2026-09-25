import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api } from '@/lib/api';
import { postSse } from '@/lib/sse';
import { chatReducer, initialChatState } from './reducer';

const BUSY_POLL_MS = 3000;

export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const sendingRef = useRef(false);
  sendingRef.current = state.sending;

  const reload = useCallback(async () => {
    if (sendingRef.current) return;
    try {
      const { messages, busy } = await api.messages();
      if (!sendingRef.current) dispatch({ type: 'loaded', messages, busy });
    } catch {
      // 401 is handled globally; other failures keep the current view.
    }
  }, []);

  useEffect(() => {
    void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  // While the server is still working on a reply we are not streaming, poll for it.
  useEffect(() => {
    if (!state.remoteBusy || state.sending) return;
    const t = setTimeout(() => void reload(), BUSY_POLL_MS);
    return () => clearTimeout(t);
  }, [state.remoteBusy, state.sending, state.messages, reload]);

  const stream = useCallback(async (path: string, body: unknown, acceptedAlready: boolean) => {
    let accepted = acceptedAlready;
    let finished = false;
    try {
      await postSse(path, body, (event, data) => {
        if (event === 'user') {
          accepted = true;
          dispatch({ type: 'user', message: data.message });
        } else if (event === 'delta') {
          dispatch({ type: 'delta', text: data.text });
        } else if (event === 'tool') {
          dispatch({ type: 'tool', phase: data.phase, id: data.id, name: data.name, label: data.label, emoji: data.emoji });
        } else if (event === 'done' || event === 'error') {
          finished = true;
          dispatch({ type: 'finished', message: data.message });
        }
      });
    } catch (err) {
      if (!accepted) {
        dispatch({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }
    // The connection dropped (e.g. iOS suspended the app); the server keeps going.
    if (!finished) dispatch({ type: 'detached' });
  }, []);

  const send = useCallback(
    (text: string) => {
      dispatch({ type: 'send', text });
      void stream('/api/chat', { text }, false);
    },
    [stream],
  );

  const retry = useCallback(() => {
    dispatch({ type: 'retry' });
    void stream('/api/chat/retry', {}, true);
  }, [stream]);

  // The open stream (if any) then receives `done` with the partial reply.
  const stop = useCallback(async () => {
    await api.stopChat().catch(() => {});
    if (!sendingRef.current) void reload();
  }, [reload]);

  return { state, send, retry, stop };
}
