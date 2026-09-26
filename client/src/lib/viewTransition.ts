import { flushSync } from 'react-dom';

export type NavDirection = 'forward' | 'back';

/**
 * Runs a screen change inside a View Transition (Safari 18+, Chromium). The direction is
 * exposed as `html[data-nav]` for the CSS in index.css. Falls back to an instant change.
 */
export function navigateWithTransition(direction: NavDirection, update: () => void): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('startViewTransition' in document) || reduceMotion) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.nav = direction;
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
  });
}
