export interface RateLimiter {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
}

export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const failures = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const cutoff = now() - opts.windowMs;
    const list = (failures.get(key) ?? []).filter((t) => t > cutoff);
    failures.set(key, list);
    return list;
  };
  return {
    isBlocked: (key) => recent(key).length >= opts.max,
    recordFailure: (key) => {
      recent(key).push(now());
    },
  };
}
