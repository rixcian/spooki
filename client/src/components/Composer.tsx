import { ArrowUp, Camera, FileText, Image, Mic, Plus, Square } from 'lucide-react';
import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu';
import { useBotName } from '@/lib/botName';
import { useSpeechToText } from '@/lib/speech';
import { cn } from '@/lib/utils';

const iconButton =
  'grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-bubble-assistant active:scale-95 disabled:opacity-40';

function AttachItem({ icon, index, children }: { icon: ReactNode; index: number; children: ReactNode }) {
  return (
    <MenuItem
      disabled
      style={{ animationDelay: `${60 + index * 45}ms` }}
      className="min-h-11 origin-left animate-pop gap-3 rounded-xl px-3 text-[15px] sm:min-h-11 sm:text-[15px]"
    >
      {icon}
      <span className="flex-1">{children}</span>
      <span className="rounded-full bg-bubble-assistant px-2 py-0.5 text-xs text-muted-foreground">Soon</span>
    </MenuItem>
  );
}

// Attachments are not supported yet; the menu shows what is coming.
function AttachMenu() {
  return (
    <Menu>
      {/* The + turns into an × while the menu is open. */}
      <MenuTrigger
        aria-label="Add attachment"
        className={cn(iconButton, 'text-foreground data-popup-open:bg-bubble-assistant')}
      >
        <Plus
          className="size-6 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] in-data-popup-open:rotate-45"
          strokeWidth={1.75}
        />
      </MenuTrigger>
      {/* Springs up out of the + button; shrinks back into it on close. */}
      <MenuPopup
        side="top"
        align="start"
        sideOffset={12}
        className={cn(
          'w-60 rounded-2xl p-1 shadow-soft',
          'transition-[scale,opacity,translate] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          'data-starting-style:translate-y-2 data-starting-style:scale-50 data-starting-style:opacity-0',
          'data-ending-style:translate-y-1 data-ending-style:scale-75 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-in',
        )}
      >
        <AttachItem index={0} icon={<Image className="size-5" />}>
          Photo library
        </AttachItem>
        <AttachItem index={1} icon={<Camera className="size-5" />}>
          Take photo
        </AttachItem>
        <AttachItem index={2} icon={<FileText className="size-5" />}>
          File
        </AttachItem>
      </MenuPopup>
    </Menu>
  );
}

export function Composer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const { name } = useBotName();
  const textRef = useRef(text);
  textRef.current = text;
  const speech = useSpeechToText(
    useCallback(() => textRef.current, []),
    useCallback((t: string) => setText(t), []),
  );
  const canSend = !busy && text.trim().length > 0;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    speech.stop();
    onSend(trimmed);
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  }

  return (
    <form onSubmit={submit} className="px-4 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
      {speech.error && <p className="mx-auto mb-2 max-w-2xl px-4 text-sm text-muted-foreground">{speech.error}</p>}
      <div className="mx-auto flex max-w-2xl items-end gap-1 rounded-[28px] bg-surface p-1.5 shadow-soft">
        <AttachMenu />
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={speech.listening ? 'Listening…' : 'Message'}
          rows={1}
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[17px] leading-6 outline-none placeholder:text-muted-foreground/70"
        />
        {speech.supported && (
          <button
            type="button"
            aria-label={speech.listening ? 'Stop dictation' : 'Dictate'}
            aria-pressed={speech.listening}
            onClick={speech.listening ? speech.stop : speech.start}
            className={cn(iconButton, speech.listening && 'bg-destructive/10 text-destructive-foreground animate-pulse')}
          >
            <Mic className="size-5" />
          </button>
        )}
        {busy ? (
          <button
            type="button"
            aria-label={`Stop ${name}`}
            onClick={onStop}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background transition active:scale-95"
          >
            <Square className="size-3.5" fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full transition active:scale-95',
              canSend ? 'brand-gradient' : 'bg-bubble-user text-bubble-user-foreground/50',
            )}
          >
            <ArrowUp className="size-5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );
}
