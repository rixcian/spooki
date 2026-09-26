import type { Element, Root } from 'hast';
import { describe, it, expect } from 'vitest';
import { rehypeStream } from './rehypeStream';

const el = (tagName: string, children: Root['children'] = []): Element => ({
  type: 'element', tagName, properties: {}, children: children as Element['children'],
});
const text = (value: string) => ({ type: 'text' as const, value });

function run(tree: Root): Root {
  rehypeStream()(tree);
  return tree;
}

const classOf = (n: unknown) => ((n as Element).properties?.className as string[] | undefined)?.[0];

describe('rehypeStream', () => {
  it('wraps words in fade-in spans, keeps whitespace as text, and appends a caret to the last block', () => {
    const tree = run({ type: 'root', children: [el('p', [text('Hello  there')])] });
    const p = tree.children[0] as Element;
    expect(p.children.map((c) => (c.type === 'text' ? `"${c.value}"` : classOf(c)))).toEqual([
      'stream-word', '"  "', 'stream-word', 'stream-caret',
    ]);
    expect(((p.children[0] as Element).children[0] as { value: string }).value).toBe('Hello');
  });

  it('leaves code untouched and puts the caret after the last block, even inside lists', () => {
    const tree = run({
      type: 'root',
      children: [el('pre', [el('code', [text('a b')])]), el('ul', [el('li', [text('one')]), el('li', [text('two')])])],
    });
    const code = (tree.children[0] as Element).children[0] as Element;
    expect(code.children).toEqual([text('a b')]);
    const lastLi = (tree.children[1] as Element).children[1] as Element;
    expect(classOf(lastLi.children.at(-1))).toBe('stream-caret');
  });

  it('adds just a caret for an empty tree', () => {
    const tree = run({ type: 'root', children: [] });
    expect(classOf(tree.children[0])).toBe('stream-caret');
  });
});
