import type { SyntaxNode } from '@lezer/common';
import type { Heading } from '../domain/section';

export function headingFact(text: string, node: SyntaxNode): Heading {
  const atx = node.name.startsWith('ATX');
  const marks = node.getChildren('HeaderMark');
  const from = atx ? marks[0]!.to : node.from;
  const to = atx ? marks[1]?.from ?? node.to : marks[0]!.from;
  const title = text.slice(from, to).trim();
  const control = [...title].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  let plain = title.length > 0 && !control && !/\[\[|\]\]|%%|==|\$|\{#|(?:^|\s)\^[A-Za-z0-9-]+(?:\s|$)/.test(title);
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.name !== 'HeaderMark') plain = false;
  const topLevel = node.parent?.name === 'Document';
  return { from: topLevel ? text.lastIndexOf('\n', node.from - 1) + 1 : node.from, to: node.to,
    level: Number(node.name.at(-1)), title, topLevel, atx, plain };
}
