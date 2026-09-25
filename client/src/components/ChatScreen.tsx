import { Menu, RotateCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useChat } from '@/chat/useChat';
import { Composer } from '@/components/Composer';
import { FloatingButton, pillSecondary } from '@/components/FloatingButton';
import { AgentBadge, Mascot } from '@/components/Mascot';
import { MessageBubble, StreamingBubble, TypingDots, streamingStatus } from '@/components/MessageBubble';
import { Button } from '@/components/ui/button';

export function ChatScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, send, retry } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);

  useEffect(() => {
    if (state.messages.length === 0) return;
    // Jump on first load, glide afterwards.
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: scrolledOnce.current ? 'smooth' : 'auto' });
    scrolledOnce.current = true;
  }, [state.messages.length, state.streaming?.text, state.streaming?.tools.length, state.remoteBusy]);

  const last = state.messages.at(-1);
  const canRetry = !state.sending && !state.remoteBusy && last?.role === 'assistant' && last.status === 'error';
  const waiting = !state.sending && state.remoteBusy;
  const status = state.streaming
    ? streamingStatus(state.streaming.tools, state.streaming.text)
    : waiting
      ? 'Still working…'
      : null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="pointer-events-none relative z-10 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <div className="absolute inset-0 -bottom-6 bg-gradient-to-b from-canvas via-canvas/90 to-transparent" />
        <div className="relative mx-auto flex max-w-2xl items-start justify-center">
          <FloatingButton aria-label="Settings" onClick={onOpenSettings} className="pointer-events-auto absolute top-1 left-0">
            <Menu className="size-5" />
          </FloatingButton>
          <AgentBadge status={status} />
        </div>
      </header>

      <main className="-mt-4 flex-1 overflow-y-auto px-4 pt-6 pb-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {state.messages.length === 0 && !state.sending && (
            <div className="flex flex-col items-center gap-3 pt-16 text-center">
              <Mascot className="size-28 shadow-soft" />
              <p className="text-2xl font-semibold tracking-tight">What can I take off your plate?</p>
              <p className="text-muted-foreground">Ask me anything. Scheduled updates show up here too.</p>
            </div>
          )}
          {state.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {state.streaming && <StreamingBubble text={state.streaming.text} tools={state.streaming.tools} />}
          {waiting && (
            <div className="flex flex-col items-start gap-1.5">
              <TypingDots />
              <p className="px-2 text-sm text-muted-foreground">Hermik is still working — you&apos;ll get a notification.</p>
            </div>
          )}
          {canRetry && (
            <div>
              <Button className={`${pillSecondary} h-10 px-4 sm:h-10`} onClick={retry}>
                <RotateCw /> Retry
              </Button>
            </div>
          )}
          {state.error && (
            <p role="alert" className="px-2 text-sm text-destructive-foreground">
              {state.error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <Composer disabled={state.sending || state.remoteBusy} onSend={send} />
    </div>
  );
}
