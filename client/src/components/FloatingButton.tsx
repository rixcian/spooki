import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function FloatingButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'grid size-12 place-items-center rounded-full bg-surface text-foreground shadow-soft transition active:scale-95',
        className,
      )}
      {...props}
    />
  );
}

export const pillPrimary =
  'h-12 rounded-full border-0 brand-gradient px-6 text-white text-base font-semibold shadow-soft before:hidden hover:opacity-95 sm:h-12 sm:text-base';
export const pillSecondary =
  'h-12 rounded-full border-0 bg-bubble-assistant px-6 text-base font-medium text-foreground shadow-none before:hidden hover:bg-bubble-assistant/80 sm:h-12 sm:text-base';
