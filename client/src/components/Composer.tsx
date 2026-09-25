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

const BAR_DELAYS = [0, 180, 90, 270];

function MicButton({ listening, onClick }: { listening: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={listening ? 'Stop dictation' : 'Dictate'}
      aria-pressed={listening}
      onClick={onClick}
      className={cn(
        iconButton,
        'relative transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
        listening && 'scale-110 brand-gradient text-white hover:bg-transparent',
      )}
    >
      {listening && (
        <>
          <span className="mic-ripple" />
          <span className="mic-ripple" style={{ animationDelay: '0.9s' }} />
        </>
      )}
      <span className="relative grid size-5 place-items-center">
        <Mic
          className={cn(
            'col-start-1 row-start-1 size-5 transition-all duration-300',
            listening ? 'scale-0 rotate-90 opacity-0' : 'scale-100 opacity-100',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'col-start-1 row-start-1 flex h-4 items-center gap-[3px] transition-all duration-300',
            listening ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          )}
        >
          {BAR_DELAYS.map((d) => (
            <span key={d} className="mic-bar" style={{ animationDelay: `${d}ms` }} />
          ))}
        </span>
      </span>
    </button>
  );
}

// One button that morphs: the arrow spins out and a square pops in while the agent works,
// with a gradient ring orbiting it. Staying mounted lets both directions animate.
function SendStopButton({
  busy,
  canSend,
  stopLabel,
  onStop,
}: {
  busy: boolean;
  canSend: boolean;
  stopLabel: string;
  onStop: () => void;
}) {
  const spring = 'transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]';
  return (
    <button
      type={busy ? 'button' : 'submit'}
      aria-label={busy ? stopLabel : 'Send'}
      disabled={!busy && !canSend}
      onClick={busy ? onStop : undefined}
      className="group relative grid size-10 shrink-0 place-items-center rounded-full transition-transform active:scale-90"
    >
      {busy && <span aria-hidden className="stop-orbit" />}
      {/* Background layers cross-fade (gradients can't transition directly). */}
      <span aria-hidden className="absolute inset-0 rounded-full bg-bubble-user" />
      <span
        aria-hidden
        className={cn('absolute inset-0 rounded-full brand-gradient transition-opacity duration-300', canSend && !busy ? 'opacity-100' : 'opacity-0')}
      />
      <span
        aria-hidden
        className={cn('absolute inset-0 rounded-full bg-foreground', spring, busy ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}
      />
      <span className="relative grid place-items-center">
        <ArrowUp
          strokeWidth={2.5}
          className={cn(
            'col-start-1 row-start-1 size-5',
            spring,
            canSend ? 'text-white' : 'text-bubble-user-foreground/50',
            busy ? '-translate-y-3 scale-50 rotate-90 opacity-0' : 'translate-y-0 scale-100 opacity-100',
          )}
        />
        <Square
          fill="currentColor"
          className={cn(
            'col-start-1 row-start-1 size-3.5 text-background',
            spring,
            busy ? 'animate-breathe scale-100 opacity-100' : 'scale-0 -rotate-90 opacity-0',
          )}
        />
      </span>
    </button>
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
          <MicButton listening={speech.listening} onClick={speech.listening ? speech.stop : speech.start} />
        )}
        <SendStopButton busy={busy} canSend={canSend} stopLabel={`Stop ${name}`} onStop={onStop} />
      </div>
    </form>
  );
}
