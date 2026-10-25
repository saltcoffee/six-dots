import { describe, expect, it } from 'vitest';
import { pointsToFile, rewriteLinks } from '../src/obsidian/links';
import { posix } from 'node:path';
const files = ['Knowledge/Target.md', 'Assets/image.png', 'file.md', 'Inbox/Source.md'];
const resolve = (path: string, source: string) => {
  const candidates = [path, path.endsWith('.md') ? path : path + '.md', posix.normalize(posix.join(posix.dirname(source), path))];
  const file = candidates.find(candidate => files.includes(candidate)) ?? files.find(file => file.split('/').at(-1) === path || file.split('/').at(-1) === path + '.md');
  return file ? { path: file } : null;
};

describe('extracted link transport', () => {
  it('checks the actual file identity of a generated source replacement', () => {
    expect(pointsToFile('[[Knowledge/Target]]', 'Inbox/Source.md', 'Knowledge/Target.md', resolve)).toBe(true);
    expect(pointsToFile('[Target](../Knowledge/Target.md)', 'Inbox/Source.md', 'Knowledge/Target.md', resolve)).toBe(true);
    expect(pointsToFile('[[Knowledge/Target#wrong]]', 'Inbox/Source.md', 'Knowledge/Target.md', resolve)).toBe(false);
    expect(pointsToFile('[[Unknown]]', 'Inbox/Source.md', 'Knowledge/Target.md', resolve)).toBe(false);
  });
  it('keeps wiki aliases, embeds and source-local anchors', () => {
    expect(rewriteLinks('[[Target|别名]] ![[image.png]] [[#Heading]]', 'Inbox/Source.md', 'Notes/New.md', resolve))
      .toBe('[[Knowledge/Target|别名]] ![[Assets/image.png]] [[Inbox/Source#Heading]]');
  });
  it('rebases Markdown URLs without changing labels or titles', () => {
    expect(rewriteLinks('[label](../file.md#Part "title")', 'Inbox/Source.md', 'Notes/Deep/New.md', resolve)).toBe('[label](../../file.md#Part "title")');
  });
  it('rebases both URLs in a linked image', () => {
    expect(rewriteLinks('[![image](image.png)](../file.md)', 'Inbox/Source.md', 'Notes/New.md', resolve)).toBe('[![image](../Assets/image.png)](../file.md)');
  });
  it('refuses a rewrite when the host resolves its new path differently', () => {
    const conflicting = (path: string, source: string) => source.startsWith('Notes/') ? { path: 'Other.md' } : resolve(path, source);
    expect(() => rewriteLinks('[[Target]]', 'Inbox/Source.md', 'Notes/New.md', conflicting)).toThrow();
  });
  it('leaves external URLs and links in code unchanged', () => {
    const source = '[web](https://example.com/a) <https://example.com/autolink> `[[Unknown]]`\n\n```\n[[Unknown]]\n```';
    expect(rewriteLinks(source, 'Source.md', 'New.md', resolve)).toBe(source);
  });
  it.each(['[[Unknown]]', '[ref][label]', '[ref]: Target', 'text [^footnote]', '<img src="relative.png">'])('rejects unresolved dependencies: %s', source => {
    expect(() => rewriteLinks(source, 'Source.md', 'New.md', resolve)).toThrow();
  });
});
