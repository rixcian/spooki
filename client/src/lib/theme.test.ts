import { describe, it, expect } from 'vitest';
import { isDarkAt, msUntilNextSwitch, parseThemeMode, resolveDark } from './theme';

const at = (h: number, m = 0) => new Date(2026, 8, 25, h, m);

describe('theme', () => {
  it('auto is dark from 19:00 until 7:00', () => {
    expect(isDarkAt(at(18, 59))).toBe(false);
    expect(isDarkAt(at(19, 0))).toBe(true);
    expect(isDarkAt(at(23, 30))).toBe(true);
    expect(isDarkAt(at(6, 59))).toBe(true);
    expect(isDarkAt(at(7, 0))).toBe(false);
  });

  it('resolves each mode', () => {
    expect(resolveDark('light', at(22))).toBe(false);
    expect(resolveDark('dark', at(12))).toBe(true);
    expect(resolveDark('auto', at(22))).toBe(true);
  });

  it('computes the time until the next auto switch', () => {
    expect(msUntilNextSwitch(at(18, 0))).toBe(60 * 60 * 1000);
    expect(msUntilNextSwitch(at(23, 0))).toBe(8 * 60 * 60 * 1000);
    expect(msUntilNextSwitch(at(6, 30))).toBe(30 * 60 * 1000);
  });

  it('parses stored values, defaulting to auto', () => {
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode(null)).toBe('auto');
    expect(parseThemeMode('purple')).toBe('auto');
  });
});
