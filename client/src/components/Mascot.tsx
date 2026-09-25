import { useBotName } from '@/lib/botName';
import { cn } from '@/lib/utils';

export function Mascot({ className, thinking = false }: { className?: string; thinking?: boolean }) {
  return (
    <img
      src="/hermik-avatar.jpg"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('size-14 rounded-full bg-white object-cover select-none', thinking && 'animate-float', className)}
    />
  );
}

// Pops in (springy) when the conversation starts; hidden on the empty greeting screen.
export function AgentBadge({ status, hidden = false }: { status?: string | null; hidden?: boolean }) {
  const { name } = useBotName();
  return (
    <div
      aria-hidden={hidden}
      className={cn(
        'flex origin-top flex-col items-center transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
        hidden ? 'pointer-events-none -translate-y-4 scale-50 opacity-0' : 'translate-y-0 scale-100 opacity-100 delay-150',
      )}
    >
      <div
        className="grid size-16 place-items-center overflow-hidden rounded-full bg-white shadow-soft"
        style={hidden ? undefined : { viewTransitionName: 'bot-avatar' }}
      >
        <Mascot className="size-16" thinking={Boolean(status)} />
      </div>
      <div className="-mt-2 flex max-w-64 flex-col items-center rounded-2xl bg-surface px-4 py-1.5 text-center shadow-soft">
        <span className="font-semibold leading-tight">{name}</span>
        {status && <span className="truncate text-sm text-muted-foreground leading-tight">{status}</span>}
      </div>
    </div>
  );
}
