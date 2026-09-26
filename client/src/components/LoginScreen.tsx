import { useState, type FormEvent } from 'react';
import { pillPrimary } from '@/components/FloatingButton';
import { Mascot } from '@/components/Mascot';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useBotName } from '@/lib/botName';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { name } = useBotName();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="size-32 overflow-hidden rounded-full bg-white shadow-soft">
          <Mascot className="size-32" />
        </div>
        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Hi, I&apos;m {name}</h1>
          <p className="text-muted-foreground">Whisper the secret word, if you dare… 👻</p>
        </div>
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-14 w-full rounded-full bg-surface px-6 text-[17px] shadow-soft outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-brand-from/40"
        />
        {error && (
          <p role="alert" className="-mt-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}
        <Button type="submit" className={`${pillPrimary} h-14 w-full sm:h-14`} disabled={!password} loading={busy}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
