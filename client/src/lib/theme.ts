import { flushSync } from 'react-dom';
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'spooki.theme';
export const DARK_FROM_HOUR = 19;
export const DARK_UNTIL_HOUR = 7;
const THEME_COLOR = { light: '#fbfbfc', dark: '#0b1020' };

export function isDarkAt(date: Date): boolean {
  const h = date.getHours();
  return h >= DARK_FROM_HOUR || h < DARK_UNTIL_HOUR;
}

export function resolveDark(mode: ThemeMode, now: Date = new Date()): boolean {
  return mode === 'auto' ? isDarkAt(now) : mode === 'dark';
}

/** Milliseconds from `now` until the next 7:00 or 19:00. */
export function msUntilNextSwitch(now: Date): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  const h = now.getHours();
  if (h < DARK_UNTIL_HOUR) next.setHours(DARK_UNTIL_HOUR);
  else if (h < DARK_FROM_HOUR) next.setHours(DARK_FROM_HOUR);
  else {
    next.setDate(next.getDate() + 1);
    next.setHours(DARK_UNTIL_HOUR);
  }
  return next.getTime() - now.getTime();
}

export function parseThemeMode(value: string | null): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
}

// A tiny store: the mode lives in localStorage (per device) and in memory.
let mode: ThemeMode = 'auto';
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function readStored(): ThemeMode {
  try {
    return parseThemeMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

function paint(): void {
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
}

// In auto mode, flip exactly at 7:00 / 19:00 (and re-check when the app comes back to the front).
function schedule(): void {
  clearTimeout(timer);
  if (mode !== 'auto') return;
  timer = setTimeout(() => {
    paint();
    schedule();
  }, msUntilNextSwitch(new Date()) + 1000);
}

export function initTheme(): void {
  mode = readStored();
  paint();
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      paint();
      schedule();
    }
  });
}

/**
 * Switches the theme. With an `origin` (the tapped point) the new theme is revealed as a circle
 * growing from there (View Transitions; instant where unsupported or with Reduce Motion).
 */
export function setThemeMode(next: ThemeMode, origin?: { x: number; y: number }): void {
  const apply = () => {
    mode = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode: the in-memory choice still applies
    }
    paint();
    schedule();
    listeners.forEach((l) => l());
  };
  const changesLook = resolveDark(next) !== resolveDark(mode);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!origin || !changesLook || reduceMotion || !('startViewTransition' in document)) {
    apply();
    return;
  }
  const root = document.documentElement;
  root.style.setProperty('--reveal-x', `${origin.x}px`);
  root.style.setProperty('--reveal-y', `${origin.y}px`);
  root.dataset.nav = 'theme';
  const t = document.startViewTransition(() => flushSync(apply));
  void t.finished.finally(() => {
    if (root.dataset.nav === 'theme') delete root.dataset.nav;
  });
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mode,
  );
}
