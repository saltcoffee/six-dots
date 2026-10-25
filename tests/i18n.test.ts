import { describe, expect, it } from 'vitest';
import { translator } from '../src/i18n';
import { en } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';

describe('Obsidian locale policy', () => {
  it.each(['zh', 'zh-CN', 'zh-cn', 'zh-TW', 'zh_HK', ' ZH-Hans '])('uses Chinese for %s', locale => {
    expect(translator(locale)('actions')).toBe('打开块操作');
  });
  it.each(['en', 'en-GB', 'ja', 'ko', 'de', 'fr', '', 'zhx', 'es'])('uses English for %s', locale => {
    expect(translator(locale)('actions')).toBe('Open block actions');
  });
  it('provides the same complete set of messages', () => { expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort()); });
});
