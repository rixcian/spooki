import { Menu, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isEmptyChat } from '@/chat/reducer';
import { useChat } from '@/chat/useChat';
import { Composer } from '@/components/Composer';
import { FloatingButton, pillSecondary } from '@/components/FloatingButton';
import { AgentBadge, Mascot } from '@/components/Mascot';
import { MessageBubble, StreamingBubble, TypingDots, streamingStatus } from '@/components/MessageBubble';
import { Button } from '@/components/ui/button';
import { useBotName } from '@/lib/botName';
import { cn } from '@/lib/utils';

// Big greeting for a fresh chat. On the first message it floats up and shrinks away
// while the header badge pops in, so the avatar seems to move into the header.
function Greeting({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none absolute inset-x-0 top-[18%] flex flex-col items-center gap-3 px-6 text-center transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
        visible ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-40 scale-50 opacity-0',
      )}
    >
      <div
        className={cn('size-28 overflow-hidden rounded-full bg-white shadow-soft', visible && 'animate-bob')}
        style={visible ? { viewTransitionName: 'bot-avatar' } : undefined}
      >
        <Mascot className="size-28" />
      </div>
      <p
        className={cn(
          'text-2xl font-semibold tracking-tight transition-all delay-75 duration-500',
          visible ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0',
        )}
      >
        What can I take off your plate?
      </p>
      <p className={cn('text-muted-foreground transition-all delay-100 duration-500', visible ? 'opacity-100' : 'opacity-0')}>
        Ask me anything. Scheduled updates show up here too.
      </p>
    </div>
  );
}

const RETRY_SPIN_MS = 450;

// Pops in with a wiggle, nudges its arrow as a hint, and spins it around before retrying.
function RetryButton({ onRetry }: { onRetry: () => void }) {
  const [spinning, setSpinning] = useState(false);

  function click() {
    if (spinning) return;
    setSpinning(true);
    setTimeout(onRetry, RETRY_SPIN_MS);
  }

  return (
    <div className="retry-enter origin-left self-start">
      <Button
        className={`${pillSecondary} h-10 px-4 transition-transform active:scale-90 sm:h-10`}
        onClick={click}
        aria-busy={spinning}
      >
        <RotateCw className={spinning ? 'retry-spin' : 'retry-nudge'} /> Retry
      </Button>
    </div>
  );
}

export function ChatScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, send, retry, stop } = useChat();
  const { name } = useBotName();
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerH, setComposerH] = useState(80);
  const scrolledOnce = useRef(false);
  // Messages at or after this index arrived while the screen was open and get a pop-in.
  const firstNew = useRef<number | null>(null);
  if (state.loaded && firstNew.current === null) firstNew.current = state.messages.length;

  // The composer floats over the list and grows with its text; keep the fade and spacer in sync.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setComposerH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (state.messages.length === 0) return;
    // Jump on first load, glide afterwards.
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: scrolledOnce.current ? 'smooth' : 'auto' });
    scrolledOnce.current = true;
  }, [state.messages.length, state.streaming?.text, state.streaming?.tools.length, state.remoteBusy, composerH]);

  const empty = isEmptyChat(state);
  const last = state.messages.at(-1);
  const canRetry = !state.sending && !state.remoteBusy && last?.role === 'assistant' && last.status === 'error';
  const waiting = !state.sending && state.remoteBusy;
  const status = state.streaming
    ? streamingStatus(state.streaming.tools, state.streaming.text)
    : waiting
      ? 'Still working…'
      : null;

  return (
    <div className="relative flex h-dvh flex-col">
      {/* Floats over the messages, which scroll underneath it. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="relative mx-auto flex min-h-[5.5rem] max-w-2xl items-start justify-center">
          <FloatingButton
            aria-label="Settings"
            onClick={onOpenSettings}
            className="pointer-events-auto absolute top-1 left-0"
            style={{ viewTransitionName: 'nav-button' }}
          >
            <Menu className="size-5" />
          </FloatingButton>
          <AgentBadge status={status} hidden={!state.loaded || empty} />
        </div>
      </header>

      <main
        className="fade-edges relative flex-1 overflow-y-auto px-4 pt-[calc(max(env(safe-area-inset-top),0.75rem)+6.5rem)]"
        style={{ '--composer-h': `${composerH}px` } as CSSProperties}
      >
        <Greeting visible={empty} />
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {state.messages.map((m, i) => (
            // Index keys: the list only grows at the end, and an optimistic message is replaced
            // in place by its saved copy without re-mounting (no second pop).
            <MessageBubble
              key={i}
              message={m}
              animate={
                firstNew.current !== null &&
                i >= firstNew.current &&
                // A finished chat reply replaces the streaming bubble that already popped in.
                !(m.role === 'assistant' && m.source === 'chat')
              }
            />
          ))}
          {state.streaming && <StreamingBubble text={state.streaming.text} tools={state.streaming.tools} />}
          {waiting && (
            <div className="flex flex-col items-start gap-1.5">
              <TypingDots />
              <p className="px-2 text-sm text-muted-foreground">{name} is still working — you&apos;ll get a notification.</p>
            </div>
          )}
          {canRetry && <RetryButton onRetry={retry} />}
          {state.error && (
            <p role="alert" className="px-2 text-sm text-destructive-foreground">
              {state.error}
            </p>
          )}
          {/* Spacer: the floating composer plus the bottom fade (2.5rem in .fade-edges), so the
              newest message rests fully visible above it. */}
          <div ref={bottomRef} aria-hidden style={{ height: `calc(${composerH}px + 2.5rem)` }} className="shrink-0" />
        </div>
      </main>

      <div ref={composerRef} className="absolute inset-x-0 bottom-0 z-10">
        <Composer busy={state.sending || state.remoteBusy} onSend={send} onStop={() => void stop()} />
      </div>
    </div>
  );
}
