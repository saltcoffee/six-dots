import { describe, expect, it } from 'vitest';
import { releaseNotes } from '../scripts/release-notes.mjs';

describe('release changelog extraction', () => {
  it('publishes only the requested version content directly', () => {
    const text = '# Changelog\n\n## Unreleased\n\nFuture work\n\n## 0.2.0 - 2026-10-25\n\n### Added\n\n- Current change.\n\n## 0.1.0\n\n- Older change.\n';
    expect(releaseNotes(text, '0.2.0')).toBe('### Added\n\n- Current change.\n');
  });
  it('handles bracketed versions and the final section without a trailing newline', () => {
    expect(releaseNotes('# Changelog\n\n## [0.1.0]\n\n- First release.', '0.1.0')).toBe('- First release.\n');
  });
  it('does not select a version with a matching prefix', () => {
    expect(() => releaseNotes('## 0.1.01\n\n- Other version.', '0.1.0')).toThrow();
  });
  it('rejects missing or empty release descriptions', () => {
    expect(() => releaseNotes('## Unreleased\n\nFuture.', '0.1.0')).toThrow();
    expect(() => releaseNotes('## 0.1.0\n\n## 0.0.1\n\nOld.', '0.1.0')).toThrow();
  });
});
