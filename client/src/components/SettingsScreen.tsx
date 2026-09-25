import { Bell, ChevronLeft, Clock, LogOut, Moon, Palette, PlugZap, RotateCcw, Sun } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { FloatingButton, pillPrimary, pillSecondary } from '@/components/FloatingButton';
import { EditableBadge } from '@/components/EditableBadge';
import { Button } from '@/components/ui/button';
import { api, type SettingsView, type TestResult } from '@/lib/api';
import { useBotName } from '@/lib/botName';
import { enablePush, pushStatus, type PushStatus } from '@/lib/push';
import { DARK_FROM_HOUR, DARK_UNTIL_HOUR, setThemeMode, useThemeMode, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const PUSH_TEXT: Record<PushStatus, string> = {
  enabled: 'Notifications are on.',
  disabled: 'Get a ping when a reply arrives or a scheduled job finishes.',
  denied: 'Notifications are blocked. Allow them in iOS Settings → Notifications → Spooki.',
  'needs-install': 'Add Spooki to your Home Screen (Share → Add to Home Screen) to enable notifications.',
  unsupported: 'This browser does not support push notifications.',
};

const THEMES: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
  { mode: 'light', label: 'Light', icon: <Sun className="size-4" /> },
  { mode: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
  { mode: 'auto', label: 'Auto', icon: <Clock className="size-4" /> },
];

// Segmented control with a springy sliding thumb.
function ThemePicker() {
  const current = useThemeMode();
  const index = THEMES.findIndex((t) => t.mode === current);
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Theme" className="relative grid grid-cols-3 rounded-full bg-bubble-assistant p-1">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-surface shadow-soft transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {THEMES.map((t) => (
          <button
            key={t.mode}
            type="button"
            role="radio"
            aria-checked={current === t.mode}
            onClick={(e) => setThemeMode(t.mode, { x: e.clientX, y: e.clientY })}
            className={cn(
              'relative flex h-10 items-center justify-center gap-1.5 rounded-full text-[15px] font-medium transition-colors',
              current === t.mode ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className={cn('transition-transform duration-500', current === t.mode && 'scale-110 rotate-[360deg]')}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <p className="px-1 text-sm text-muted-foreground">
        {current === 'auto'
          ? `Dark from ${DARK_FROM_HOUR}:00 to ${DARK_UNTIL_HOUR}:00, light the rest of the day.`
          : 'Saved on this device.'}
      </p>
    </div>
  );
}

const field =
  'h-12 w-full rounded-2xl bg-bubble-assistant px-4 text-[17px] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-brand-from/40';

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-3xl bg-surface p-5 shadow-soft">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <span className="grid size-8 place-items-center rounded-full bg-bubble-user text-bubble-user-foreground">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsScreen({ onBack, onLoggedOut }: { onBack: () => void; onLoggedOut: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const bot = useBotName();

  const apply = (v: SettingsView) => {
    setView(v);
    setUrl(v.hermesUrl);
    setKey('');
    bot.setName(v.botName);
  };

  useEffect(() => {
    api.getSettings().then(apply).catch((e: Error) => setNotice(e.message));
    pushStatus().then(setPush).catch(() => setPush('unsupported'));
  }, []);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      apply(await api.saveSettings({ hermesUrl: url, hermesApiKey: key }));
      setNotice('Saved.');
    });
  };

  const keyPlaceholder = view?.apiKeySet ? `•••• ${view.apiKeyLast4} (from ${view.keySource})` : 'Not set';

  return (
    <div className="min-h-dvh px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <div className="mx-auto max-w-lg space-y-5">
        {/* Same layout as the chat header, so the avatar and name stay put when switching. */}
        <div className="relative flex min-h-[5.5rem] items-start justify-center">
          <FloatingButton
            aria-label="Back"
            onClick={onBack}
            className="absolute top-1 left-0"
            style={{ viewTransitionName: 'nav-button' }}
          >
            <ChevronLeft className="size-6" />
          </FloatingButton>
          <EditableBadge onError={setNotice} />
        </div>

        <Card title="Appearance" icon={<Palette className="size-4" />}>
          <ThemePicker />
        </Card>

        <Card title="Hermes connection" icon={<PlugZap className="size-4" />}>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="url" className="px-1 text-sm font-medium text-muted-foreground">
                Server URL {view && <span className="font-normal">· from {view.urlSource}</span>}
              </label>
              <input id="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} className={field} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="key" className="px-1 text-sm font-medium text-muted-foreground">
                API key
              </label>
              <input id="key" type="password" autoComplete="off" placeholder={keyPlaceholder} value={key} onChange={(e) => setKey(e.target.value)} className={field} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className={pillPrimary} disabled={busy}>
                Save
              </Button>
              <Button
                className={pillSecondary}
                disabled={busy}
                onClick={() => void act(async () => setTest(await api.testConnection()))}
              >
                Test connection
              </Button>
            </div>
            {test && (
              <p className="px-1 text-sm">
                {test.ok ? `✅ Connected (${test.models.join(', ') || 'no models'})` : `❌ ${test.error}`}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(async () => { apply(await api.resetSettings()); setNotice('Reset to env.'); })}
              className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground disabled:opacity-60"
            >
              <RotateCcw className="size-4" /> Reset to env defaults
            </button>
          </form>
        </Card>

        <Card title="Notifications" icon={<Bell className="size-4" />}>
          {push && <p className="text-muted-foreground">{PUSH_TEXT[push]}</p>}
          {push === 'disabled' && (
            <Button
              className={pillPrimary}
              disabled={busy}
              onClick={() => void act(async () => { await enablePush(); setPush(await pushStatus()); })}
            >
              Enable notifications
            </Button>
          )}
        </Card>

        <Button
          className={`${pillSecondary} w-full`}
          onClick={() => void act(async () => { await api.logout(); onLoggedOut(); })}
        >
          <LogOut /> Log out
        </Button>

        {notice && (
          <p role="status" className="px-1 text-center text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
