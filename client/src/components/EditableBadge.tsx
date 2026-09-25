import { Check, Pencil } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Mascot } from '@/components/Mascot';
import { api } from '@/lib/api';
import { useBotName } from '@/lib/botName';
import { cn } from '@/lib/utils';

export const MAX_BOT_NAME = 40;

const pill = 'rounded-2xl bg-surface shadow-soft';

/**
 * The avatar and name pill, in the same spot as the chat header. A pen pill peeks out from
 * behind the name; tapping it edits the name right inside the pill.
 */
export function EditableBadge({ onError }: { onError: (message: string) => void }) {
  const { name, setName } = useBotName();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function start() {
    setDraft(name);
    setEditing(true);
  }

  async function commit() {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveSettings({ botName: next });
      setName(saved.botName);
      setEditing(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className="grid size-16 place-items-center overflow-hidden rounded-full bg-white shadow-soft"
        style={{ viewTransitionName: 'bot-avatar' }}
      >
        <Mascot className="size-16" />
      </div>
      <div className="relative -mt-2">
        {/* Peeks out from behind the name pill (lower z-index), then settles beside it. */}
        <button
          type="button"
          aria-label={editing ? 'Save name' : 'Rename'}
          disabled={saving}
          // Keep the input focused so a tap saves instead of blurring first.
          onMouseDown={(e) => editing && e.preventDefault()}
          onClick={editing ? () => void commit() : start}
          className={cn(
            pill,
            'pen-peek absolute top-1/2 left-full z-0 ml-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors active:scale-90',
            editing && 'brand-gradient text-white',
          )}
        >
          <span className="relative grid place-items-center">
            <Pencil
              className={cn('col-start-1 row-start-1 size-4 transition-all duration-300', editing ? 'scale-0 rotate-90 opacity-0' : 'opacity-100')}
            />
            <Check
              strokeWidth={2.75}
              className={cn('col-start-1 row-start-1 size-4 transition-all duration-300', editing ? 'opacity-100' : 'scale-0 -rotate-90 opacity-0')}
            />
          </span>
        </button>
        <div
          className={cn(pill, 'relative z-10 px-4 py-1.5 text-center transition-shadow', editing && 'ring-2 ring-brand-from/40')}
          style={{ viewTransitionName: 'bot-name' }}
        >
          {editing ? (
            <input
              ref={inputRef}
              aria-label="Name"
              value={draft}
              maxLength={MAX_BOT_NAME}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => void commit()}
              className="field-sizing-content min-w-12 max-w-56 bg-transparent text-center font-semibold leading-tight outline-none"
            />
          ) : (
            <span className="font-semibold leading-tight">{name}</span>
          )}
        </div>
      </div>
    </div>
  );
}
