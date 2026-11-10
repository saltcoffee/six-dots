import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/domain/block';
import { moveSection, sectionReason, sections, validateSectionMove } from '../src/domain/section';
import { parseSnapshot } from '../src/editor/markdown';

function exchange(text: string, title: string, direction: -1 | 1) {
  const snapshot = parseSnapshot(text), from = text.indexOf(title);
  const move = moveSection(snapshot, from, direction), result = applyEdits(text, move.plan.edits);
  validateSectionMove(snapshot, move, parseSnapshot(result));
  return { move, result };
}

describe('entire section boundaries and exchanges', () => {
  it.each([1, 2, 3, 4, 5, 6])('exchanges plain H%s sections without changing level', level => {
    const mark = '#'.repeat(level), text = `${mark} A\na\n\n${mark} B\nb`;
    expect(exchange(text, `${mark} A`, 1).result).toBe(`${mark} B\nb\n\n${mark} A\na`);
  });
  it('moves body and lower headings together, retaining parent identity and outside bytes', () => {
    const text = '---\ntitle: Demo\n---\n\nIntro\n\n# Parent\n## A\na ^a\n### Child\nchild\n\n## B\nb\n# Other\nend';
    const { result, move } = exchange(text, '## A', 1);
    expect(result).toBe('---\ntitle: Demo\n---\n\nIntro\n\n# Parent\n## B\nb\n\n## A\na ^a\n### Child\nchild\n# Other\nend');
    expect(move.source.childHeadingCount).toBe(1);
    expect(result.slice(move.plan.cursor)).toMatch(/^## A/);
  });
  it.each(['', '\n', '\n\n', '\n \n'])('preserves the exact EOF suffix %j', suffix => {
    const text = '## A\na\n\n\n## B\nb' + suffix;
    const { result } = exchange(text, '## A', 1);
    expect(result).toBe('## B\nb\n\n\n## A\na' + suffix);
    expect(exchange(result, '## A', -1).result).toBe(text);
  });
  it('moves empty sections and skipped heading levels without promoting them', () => {
    const text = '# P\n#### A\n#### B\n# Q';
    expect(exchange(text, '#### B', -1).result).toBe('# P\n#### B\n#### A\n# Q');
  });
  it.each([
    ['# P\n## A\na\n# Q\n## B\nb', '## A'],
    ['# P\n### A\na\n## B\nb', '### A'],
    ['## Only\nbody', '## Only'],
  ])('rejects a missing adjacent same-level section within the same parent', (text, title) => {
    expect(() => moveSection(parseSnapshot(text), text.indexOf(title), 1)).toThrow('sectionNoSibling');
  });
  it('keeps tables, math, comments, code, lists, links and owned IDs intact', () => {
    const body = '\n| x | y |\n| - | - |\n| 1 | 2 |\n\n$$\nx+y\n$$\n\n%%\n## Hidden\n%%\n\n```ts\n## Fake ^fake\n```\n\n- parent\n  - child ^child\n\nText [[Note]] ^text';
    const text = '## A' + body + '\n\n## B\nDone';
    expect(exchange(text, '## A', 1).result).toBe('## B\nDone\n\n## A' + body);
    expect(parseSnapshot(text).headings.map(h => h.title)).toEqual(['A', 'B']);
  });
  it.each(['## **Complex**', '## `Code`', '## [Link](Note)', '## [[Wiki]]', '## ==Highlight==', '## $math$', '## A ^id', '##', 'Setext\n---'])('rejects an unsupported heading anywhere in the note: %s', heading => {
    const text = '## A\na\n## B\nb\n' + heading;
    expect(sectionReason(parseSnapshot(text))).toBe('sectionTitles');
    expect(() => moveSection(parseSnapshot(text), 0, 1)).toThrow('sectionTitles');
  });
  it.each(['# Hidden %%comment%%', '## Hidden %%comment%%', 'Title %%comment%%\n---', '> ## Hidden %%comment%%', '- ## Hidden %%comment%%'])('keeps the refusal fact for a real heading containing a comment: %s', heading => {
    const text = '## A\na\n\n' + heading + '\nhidden body\n\n## B\nb';
    const snapshot = parseSnapshot(text);
    expect(sectionReason(snapshot)).toBe('sectionTitles');
    expect(() => moveSection(snapshot, 0, 1)).toThrow('sectionTitles');
  });
  it('ignores pseudo headings in later comment pairs, math and code without losing real headings', () => {
    const text = '## A\na\n\nText %%first%% %%second\n# Fake\n%%\n\n$$\nMath\n---\n$$\n\n```md\n# Code %%\n```\n\n## B\nb';
    const snapshot = parseSnapshot(text);
    expect(snapshot.headings.map(h => h.title)).toEqual(['A', 'B']);
    expect(sectionReason(snapshot)).toBeNull();
  });
  it.each(['Paragraph\n%%\n---\n%%', 'Paragraph\n$$\nMath\n---\n$$'])('ignores a Setext underline inside an opaque body even when its parser node starts earlier', body => {
    const text = '## A\na\n\n' + body + '\n\n## B\nb';
    const snapshot = parseSnapshot(text);
    expect(snapshot.headings.map(h => h.title)).toEqual(['A', 'B']);
    expect(sectionReason(snapshot)).toBeNull();
    expect(exchange(text, '## A', 1).result.startsWith('## B\nb')).toBe(true);
  });
  it('projects container headings separately and supports plain Unicode punctuation and closing markers', () => {
    const snapshot = parseSnapshot('## 中文 😀! ###\n\n> ## Quote\n\n- ## List\n\n## B');
    expect(sectionReason(snapshot)).toBeNull();
    expect(snapshot.headings.map(h => [h.title, h.topLevel])).toEqual([['中文 😀!', true], ['Quote', false], ['List', false], ['B', true]]);
    expect(sections(snapshot)).toHaveLength(2);
  });
  it('rejects ambiguous IDs and forged candidate structures without altering the source', () => {
    const text = '## A\na ^dup\n\n## B\nb ^dup';
    expect(() => moveSection(parseSnapshot(text), 0, 1)).toThrow('sectionIds');
    const source = parseSnapshot('## A\na\n\n## B\nb'), move = moveSection(source, 0, 1);
    expect(() => validateSectionMove(source, move, parseSnapshot('## B\nb\n\n# A\na'))).toThrow('sectionBoundary');
    expect(source.text).toBe('## A\na\n\n## B\nb');
  });
  it.each(['```ts\ncode', '$$\nx', '%%\ncomment'])('never uses a heading swallowed by an unfinished protected body as a boundary', body => {
    const text = '## A\n' + body + '\n\n## B\nb';
    expect(() => moveSection(parseSnapshot(text), 0, 1)).toThrow('sectionNoSibling');
  });
});
