import type { Element, ElementContent, Root, RootContent } from 'hast';

// Elements the caret may descend into to sit right after the last word.
const FLOW = new Set([
  'p', 'li', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'strong', 'em', 'del', 'a',
]);

const span = (className: string, children: ElementContent[] = []): Element => ({
  type: 'element',
  tagName: 'span',
  properties: { className: [className] },
  children,
});

function wrapWords(parent: Root | Element): void {
  const out: (RootContent & ElementContent)[] = [];
  for (const child of parent.children as (RootContent & ElementContent)[]) {
    if (child.type === 'text') {
      for (const part of child.value.split(/(\s+)/)) {
        if (!part) continue;
        out.push(/^\s+$/.test(part) ? { type: 'text', value: part } : span('stream-word', [{ type: 'text', value: part }]));
      }
    } else {
      if (child.type === 'element' && child.tagName !== 'pre' && child.tagName !== 'code') wrapWords(child);
      out.push(child);
    }
  }
  parent.children = out;
}

function appendCaret(tree: Root): void {
  let target: Root | Element = tree;
  for (;;) {
    const last: RootContent | undefined = target.children.at(-1);
    if (last?.type === 'element' && FLOW.has(last.tagName)) target = last;
    else break;
  }
  (target.children as ElementContent[]).push(span('stream-caret'));
}

/**
 * Rehype plugin for a reply that is still streaming: every word becomes a span that fades in
 * once when it first mounts (React keeps existing spans), and a caret dot trails the text.
 */
export function rehypeStream() {
  return (tree: Root) => {
    wrapWords(tree);
    appendCaret(tree);
  };
}
