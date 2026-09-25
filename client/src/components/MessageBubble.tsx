import { Clock, Wrench } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolChip } from '@/chat/reducer';
import { rehypeStream } from '@/chat/rehypeStream';
import { Spinner } from '@/components/ui/spinner';
import type { Message } from '@/lib/api';
import { useBotName } from '@/lib/botName';
import { cn } from '@/lib/utils';

const bubble = 'max-w-[85%] rounded-3xl px-4.5 py-3 text-[17px] leading-snug';

const streamPlugins = [rehypeStream];

function Markdownish({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="prose max-w-none text-[17px] leading-snug break-words text-foreground dark:prose-invert prose-p:my-0 prose-p:[&+*]:mt-3 prose-pre:overflow-x-auto prose-pre:rounded-2xl prose-a:text-brand-from prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:my-2">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={streaming ? streamPlugins : undefined}>
        {text}
      </Markdown>
    </div>
  );
}

export function MessageBubble({ message, animate = false }: { message: Message; animate?: boolean }) {
  if (message.role === 'user') {
    return (
      <div className={cn('flex origin-bottom-right justify-end', animate && 'animate-pop')}>
        <div className={cn(bubble, 'whitespace-pre-wrap bg-bubble-user text-bubble-user-foreground')}>
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex origin-bottom-left flex-col items-start gap-1.5', animate && 'animate-pop')}>
      {message.source === 'cron' && (
        <span className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
          <Clock className="size-3.5" /> Scheduled · {message.cronJob}
        </span>
      )}
      <div
        className={cn(
          bubble,
          'bg-bubble-assistant',
          message.status === 'error' && 'ring-1 ring-destructive/40',
        )}
      >
        <Markdownish text={message.content} />
      </div>
    </div>
  );
}

export function TypingDots() {
  const { name } = useBotName();
  return (
    <div className="flex origin-bottom-left animate-pop">
      <div className="flex items-center gap-1.5 rounded-full bg-bubble-assistant px-4 py-3.5" aria-label={`${name} is typing`}>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-2 animate-dot rounded-full bg-foreground/60"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// A check mark that draws itself inside a popping green circle.
function DrawnCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Done" className="tool-check size-6 shrink-0">
      <circle cx="12" cy="12" r="11" className="fill-success/15" />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        pathLength={1}
        className="tool-check-path fill-none stroke-success-foreground"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Running: the tile bobs and the label shimmers. Done: the tile hops, the check draws itself,
// and the card glows green for a moment.
function ToolCard({ tool }: { tool: ToolChip }) {
  return (
    <div
      className={cn(
        'flex w-full max-w-[85%] origin-bottom-left items-center gap-3 rounded-3xl bg-bubble-assistant p-3',
        tool.done ? 'tool-done' : 'animate-pop',
      )}
    >
      <div
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-2xl bg-surface text-xl',
          tool.done ? 'tool-hop' : 'tool-bob',
        )}
      >
        {tool.emoji ?? <Wrench className="size-5 text-brand-from" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-tight">{tool.name}</p>
        {tool.done ? (
          <p key="done" className="truncate text-sm text-muted-foreground animate-pop">
            Done
          </p>
        ) : (
          <p className="tool-shimmer truncate text-sm">{tool.label ?? 'Working…'}</p>
        )}
      </div>
      {tool.done ? <DrawnCheck /> : <Spinner className="size-5 text-brand-from/70" />}
    </div>
  );
}

export function StreamingBubble({ text, tools }: { text: string; tools: ToolChip[] }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} />
      ))}
      {text ? (
        <div className={cn(bubble, 'origin-bottom-left animate-pop bg-bubble-assistant')}>
          <Markdownish text={text} streaming />
        </div>
      ) : (
        <TypingDots />
      )}
    </div>
  );
}

export function streamingStatus(tools: ToolChip[] | undefined, text: string | undefined): string {
  const running = tools?.findLast((t) => !t.done);
  if (running) return running.label ?? `Using ${running.name}…`;
  return text ? 'Writing…' : 'Thinking…';
}
