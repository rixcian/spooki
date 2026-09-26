import { describe, it, expect } from 'vitest';
import { parseSse } from './sse';

function streamOf(...parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      parts.forEach((p) => c.enqueue(enc.encode(p)));
      c.close();
    },
  });
}

describe('parseSse', () => {
  it('parses named events split across chunks and skips comments', async () => {
    const frames = [];
    for await (const f of parseSse(streamOf('event: del', 'ta\ndata: {"text":"a"}\n\n: ping\n\n', 'data: x\n\n'))) frames.push(f);
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"a"}' }, { event: null, data: 'x' }]);
  });
});
