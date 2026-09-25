import { cn } from '@/lib/utils';

export const BOT_NAME = 'Hermik';

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

export function AgentBadge({ status }: { status?: string | null }) {
  return (
    <div className="flex flex-col items-center">
      <div className="grid size-16 place-items-center overflow-hidden rounded-full bg-white shadow-soft">
        <Mascot className="size-16" thinking={Boolean(status)} />
      </div>
      <div className="-mt-2 flex max-w-64 flex-col items-center rounded-2xl bg-surface px-4 py-1.5 text-center shadow-soft">
        <span className="font-semibold leading-tight">{BOT_NAME}</span>
        {status && <span className="truncate text-sm text-muted-foreground leading-tight">{status}</span>}
      </div>
    </div>
  );
}
