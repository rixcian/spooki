import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes url-safe base64 without padding', () => {
    // bytes 0xfb 0xff 0xbf → standard "+/+/" → url-safe "-_-_"
    expect(Array.from(urlBase64ToUint8Array('-_-_'))).toEqual([0xfb, 0xff, 0xbf]);
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1]);
  });
});
