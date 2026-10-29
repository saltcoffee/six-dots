import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Fixed, artificial documents; no vault contents or random input are read. */
export function benchmarkFixtures() {
  const prose = 'Artificial SixDots benchmark text with links and ordinary words. '.repeat(4);
  const mix = [];
  for (let unit = 0; unit < 200; unit++) {
    mix.push(
      `## Sample section ${unit}`, '',
      ...Array.from({ length: 7 }, (_, row) => `${prose} ${unit}-${row}`), '',
      '- parent item', '  - child item', '    continuation', '- sibling item', '',
      '> [!note] Artificial callout', `> ${prose}`, '',
      '> Quoted text', `> ${prose}`, '',
      '```text', ...Array.from({ length: 5 }, () => prose), '```', '',
      '| First | Second |', '| --- | --- |', '| A | B |', '',
      '$$', 'x^2 + y^2 = 1', '$$', '',
      prose, '', '%% artificial comment', 'comment end %%', '',
      `Identified paragraph ${unit} ^fixture-${unit}`, '',
      prose, '', prose, '', prose, '',
    );
  }
  const fixtures = [{ id: 'P14-MIX', mode: 'mixed', text: mix.join('\n') }];
  for (const depth of [8, 16, 32]) {
    const lines = [];
    for (let group = 0; group < 60; group++) {
      for (let level = 0; level < depth; level++) {
        const indent = '  '.repeat(level);
        lines.push(`${indent}- Group ${group}, level ${level}`, `${indent}  continuation`);
      }
      const indent = '  '.repeat(depth - 1);
      lines.push(`${indent}- movable sibling`, `${indent}  \\literal text`);
    }
    fixtures.push({ id: `P14-DEEP-${depth}`, mode: 'deep-list', depth, text: lines.join('\n') });
  }
  const body = prose.repeat(Math.ceil(1024 * 1024 / prose.length)).slice(0, 1024 * 1024);
  for (const [kind, text] of [['paragraph', body], ['code', `\`\`\`text\n${body}\n\`\`\``]]) {
    fixtures.push({ id: `P14-LARGE-SOLO-${kind}`, mode: 'solo', kind, text });
    fixtures.push({ id: `P14-LARGE-MOVE-${kind}`, mode: 'move', kind, text: `Fixed sibling target.\n\n${text}` });
  }
  return fixtures;
}

export function writeFixtures(directory) {
  mkdirSync(directory, { recursive: true });
  const manifest = benchmarkFixtures().map(({ text, ...data }) => {
    const filename = `${data.id}.md`;
    writeFileSync(resolve(directory, filename), text);
    return { ...data, filename, bytes: Buffer.byteLength(text), utf16: text.length,
      lines: text.split('\n').length, sha256: createHash('sha256').update(text).digest('hex') };
  });
  writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({ generator: 'six-dots-fixtures-v1', fixtures: manifest }, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2] ?? 'docs/0.1.4/fixtures');
  const manifest = writeFixtures(directory);
  process.stdout.write(JSON.stringify({ directory, fixtures: manifest }, null, 2) + '\n');
}
