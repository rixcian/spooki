import { ArrowUp } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const canSend = !disabled && text.trim().length > 0;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  }

  return (
    <form onSubmit={submit} className="px-4 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-[28px] bg-surface py-1.5 pr-1.5 pl-5 shadow-soft">
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message"
          rows={1}
          className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[17px] leading-6 outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!canSend}
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full brand-gradient transition-all duration-200',
            canSend ? 'scale-100 opacity-100' : 'pointer-events-none scale-75 opacity-0',
          )}
        >
          <ArrowUp className="size-5" strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );
}
