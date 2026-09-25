import { describe, it, expect } from 'vitest';
import { joinTranscript } from './speech';

describe('joinTranscript', () => {
  it('appends dictated text to what was already typed', () => {
    expect(joinTranscript('', 'hello there')).toBe('hello there');
    expect(joinTranscript('Remind me', 'tomorrow')).toBe('Remind me tomorrow');
    expect(joinTranscript('Line one\n', ' two ')).toBe('Line one\ntwo');
    expect(joinTranscript('keep', '')).toBe('keep');
  });
});
