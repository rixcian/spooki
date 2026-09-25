import { cn } from '@/lib/utils';

// Hermik's own mascot: a round little messenger with Hermes-style wings.
export function Mascot({ className, thinking = false }: { className?: string; thinking?: boolean }) {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className={cn('size-14', thinking && 'animate-float', className)}>
      <defs>
        <radialGradient id="mascot-body" cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fff6ea" />
          <stop offset="100%" stopColor="#ecd6bc" />
        </radialGradient>
      </defs>
      {/* wings */}
      <path d="M13 34c-7-2-10-9-8-14 5 1 9 4 11 8 0-4 2-7 5-9 2 5 1 11-3 15z" fill="#ffffff" stroke="#bcdcff" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M67 34c7-2 10-9 8-14-5 1-9 4-11 8 0-4-2-7-5-9-2 5-1 11 3 15z" fill="#ffffff" stroke="#bcdcff" strokeWidth="1.5" strokeLinejoin="round" />
      {/* body */}
      <path d="M40 10c15 0 25 11 25 27v22c0 6-4 9-9 9-3 0-4-2-6-2s-3 2-6 2-4-2-6-2-3 2-6 2-4-2-6-2-3 2-6 2c-4 0-5-4-5-9V37c0-16 10-27 25-27z" fill="url(#mascot-body)" />
      {/* eyes */}
      <ellipse cx="32" cy="37" rx="3.2" ry="4.2" fill="#2b2622" />
      <ellipse cx="48" cy="37" rx="3.2" ry="4.2" fill="#2b2622" />
      <circle cx="33.2" cy="35.4" r="1.1" fill="#fff" />
      <circle cx="49.2" cy="35.4" r="1.1" fill="#fff" />
      {/* cheeks */}
      <ellipse cx="26" cy="45" rx="4" ry="2.4" fill="#f7a8a0" opacity="0.55" />
      <ellipse cx="54" cy="45" rx="4" ry="2.4" fill="#f7a8a0" opacity="0.55" />
      {/* smile */}
      <path d="M36.5 45.5q3.5 3 7 0" fill="none" stroke="#2b2622" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AgentBadge({ status }: { status?: string | null }) {
  return (
    <div className="flex flex-col items-center">
      <div className="grid size-16 place-items-center rounded-full bg-surface shadow-soft">
        <Mascot className="size-13" thinking={Boolean(status)} />
      </div>
      <div className="-mt-2 flex max-w-64 flex-col items-center rounded-2xl bg-surface px-4 py-1.5 text-center shadow-soft">
        <span className="font-semibold leading-tight">Hermes</span>
        {status && <span className="truncate text-sm text-muted-foreground leading-tight">{status}</span>}
      </div>
    </div>
  );
}
