import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, Plugin, Setting } from 'obsidian';
import { Platform } from 'obsidian';
import { decodeSettings, defaults, SixDotsSettingsTab } from '../src/obsidian/settings';
import type { Settings } from '../src/obsidian/settings';
import { translator } from '../src/i18n';

interface ToggleMock { value: boolean; change?: (v: boolean) => void; setValue(v: boolean): ToggleMock; onChange(fn: (v: boolean) => void): ToggleMock }
interface DropdownMock { options: Record<string, string>; value: string; disabled: boolean; change?: (v: string) => void; addOptions(o: Record<string, string>): DropdownMock; setValue(v: string): DropdownMock; setDisabled(d: boolean): DropdownMock; onChange(fn: (v: string) => void): DropdownMock }
interface TextMock { value: string; change?: (v: string) => void; setValue(v: string): TextMock; onChange(fn: (v: string) => void): TextMock }
interface SettingRow {
  name: string;
  desc: string;
  toggles: ToggleMock[];
  dropdowns: DropdownMock[];
  texts: TextMock[];
}

const ui = vi.hoisted(() => ({ rows: [] as SettingRow[], notices: [] as string[] }));

vi.mock('obsidian', () => {
  class SettingMock {
    row: SettingRow = { name: '', desc: '', toggles: [], dropdowns: [], texts: [] };
    constructor(containerEl?: { rows?: SettingRow[] }) {
      ui.rows.push(this.row);
      containerEl?.rows?.push(this.row);
    }
    setName(name: string) { this.row.name = name; return this; }
    setDesc(desc: string) { this.row.desc = desc; return this; }
    addToggle(cb: (c: ToggleMock) => void) {
      const control: ToggleMock = {
        value: false,
        setValue(v) { this.value = v; return this; },
        onChange(fn) { this.change = fn; return this; },
      };
      cb(control);
      this.row.toggles.push(control);
      return this;
    }
    addDropdown(cb: (c: DropdownMock) => void) {
      const control: DropdownMock = {
        options: {}, value: '', disabled: false,
        addOptions(o) { Object.assign(this.options, o); return this; },
        setValue(v) { this.value = v; return this; },
        setDisabled(d) { this.disabled = d; return this; },
        onChange(fn) { this.change = fn; return this; },
      };
      cb(control);
      this.row.dropdowns.push(control);
      return this;
    }
    addText(cb: (c: TextMock) => void) {
      const control: TextMock = {
        value: '',
        setValue(v) { this.value = v; return this; },
        onChange(fn) { this.change = fn; return this; },
      };
      cb(control);
      this.row.texts.push(control);
      return this;
    }
  }
  class PluginSettingTabMock {
    containerEl = { rows: [] as SettingRow[], empty() { this.rows = []; } };
    constructor(public app: unknown, public plugin: unknown) {}
  }
  return {
    Platform: { isMobile: false },
    Notice: class { constructor(message: string) { ui.notices.push(message); } },
    Setting: SettingMock,
    PluginSettingTab: PluginSettingTabMock,
  };
});

beforeEach(() => {
  Platform.isMobile = false;
  ui.rows = [];
  ui.notices = [];
});

function createTab(initial: Partial<Settings> = {}, language = 'en', saveImpl?: () => Promise<void>) {
  const settings: Settings = { ...defaults, ...initial };
  const save = vi.fn(saveImpl ?? (async () => undefined));
  const refresh = vi.fn();
  const tab = new SixDotsSettingsTab({} as App, {
    plugin: {} as Plugin,
    settings,
    save,
    refresh,
    t: translator(language),
  });
  return { tab, settings, save, refresh };
}

describe('settings decoding and dual-version tab', () => {
  it('decodes empty, 0.1.7, invalid, and future-schema settings accurately', () => {
    expect(decodeSettings(null)).toEqual({ settings: defaults, invalid: false, future: false });
    const legacy = { schemaVersion: 1, drag: false, handle: 'cursor', callout: 'tip', folder: 'Inbox/Notes' };
    expect(decodeSettings(legacy)).toEqual({ settings: legacy, invalid: false, future: false });
    const future = { schemaVersion: 2, drag: false, handle: 'cursor', callout: 'warning', folder: 'Archive', futureKey: true };
    expect(decodeSettings(future)).toEqual({
      settings: { schemaVersion: 1, drag: false, handle: 'cursor', callout: 'warning', folder: 'Archive' },
      invalid: true,
      future: true,
    });
    const traversal = decodeSettings({ schemaVersion: 1, folder: '../secret' });
    expect(traversal.settings.folder).toBe('');
    expect(traversal.invalid).toBe(true);
  });

  it.each([
    ['en', ['Enable drag and drop', 'Show handle', 'Default callout type', 'Extraction folder']],
    ['zh-CN', ['启用拖拽排序', '手柄显示方式', '默认标注类型', '提取目录']],
  ])('provides four searchable declarative definitions in %s without writing to disk', (language, expectedNames) => {
    const { tab, save, refresh, settings } = createTab({}, language);
    const snapshot = { ...settings };
    const definitions = tab.getSettingDefinitions();
    expect(definitions.map(item => item.name)).toEqual(expectedNames);
    expect(definitions.every(item => typeof item.render === 'function')).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(settings).toEqual(snapshot);
  });

  it('renders identical controls once per reopen on legacy hosts via display()', () => {
    const { tab, save, refresh } = createTab({ drag: false, handle: 'cursor', callout: 'info', folder: 'Clips' });
    tab.display();
    const container = tab.containerEl as unknown as { rows: SettingRow[] };
    expect(container.rows).toHaveLength(4);
    expect(container.rows[0]!.toggles[0]!.value).toBe(false);
    expect(container.rows[1]!.dropdowns[0]!.value).toBe('cursor');
    expect(container.rows[2]!.dropdowns[0]!.value).toBe('info');
    expect(container.rows[3]!.texts[0]!.value).toBe('Clips');

    tab.display();
    expect(container.rows).toHaveLength(4);
    expect(save).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('wires declarative render callbacks through refresh, save, trim, and error notices', async () => {
    let failNext = true;
    const { tab, settings, save, refresh } = createTab({}, 'en', async () => {
      if (failNext) { failNext = false; throw new Error('disk full'); }
    });
    const { Setting: SettingCtor } = await import('obsidian');
    const definitions = tab.getSettingDefinitions();
    const rows = definitions.map(item => {
      const s = new SettingCtor(undefined as unknown as HTMLElement).setName(item.name);
      if (item.desc) s.setDesc(item.desc);
      item.render(s as unknown as Setting);
      return (s as unknown as { row: SettingRow }).row;
    });

    rows[0]!.toggles[0]!.change?.(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(settings.drag).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(ui.notices).toEqual(['Settings could not be saved. Please try again.']);

    rows[1]!.dropdowns[0]!.change?.('cursor');
    rows[2]!.dropdowns[0]!.change?.('warning');
    rows[3]!.texts[0]!.change?.('  Notes/Extracted  ');
    await Promise.resolve();
    expect(settings).toEqual({ schemaVersion: 1, drag: false, handle: 'cursor', callout: 'warning', folder: 'Notes/Extracted' });
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(save).toHaveBeenCalledTimes(4);
    expect(ui.notices).toHaveLength(1);
  });

  it('displays cursor mode disabled on mobile without overwriting synced desktop hover preference', async () => {
    Platform.isMobile = true;
    const { tab, settings, save } = createTab({ handle: 'hover' });
    const definitions = tab.getSettingDefinitions();
    expect(definitions[1]!.desc).toContain('phones and tablets');
    tab.display();
    const container = tab.containerEl as unknown as { rows: SettingRow[] };
    const handleDropdown = container.rows[1]!.dropdowns[0]!;
    expect(handleDropdown.value).toBe('cursor');
    expect(handleDropdown.disabled).toBe(true);
    handleDropdown.change?.('cursor');
    expect(settings.handle).toBe('hover');
    expect(save).not.toHaveBeenCalled();
  });

  it('preserves serialized save order and future-schema write protection when saves finish out of order', async () => {
    const writes: Settings[] = [];
    const resolvers: (() => void)[] = [];
    let pendingSave: Promise<void> = Promise.resolve();
    let settingsFuture = false;
    const settings: Settings = { ...defaults };
    const saveSettings = () => {
      if (settingsFuture) return Promise.reject(new Error('Unsupported settings schema'));
      const snapshot = { ...settings };
      const save = pendingSave.catch(() => undefined).then(() => new Promise<void>(resolve => {
        writes.push(snapshot);
        resolvers.push(resolve);
      }));
      pendingSave = save;
      return save;
    };

    const tab = new SixDotsSettingsTab({} as App, {
      plugin: {} as Plugin, settings, save: saveSettings, refresh: vi.fn(), t: translator('en'),
    });
    tab.display();
    const container = tab.containerEl as unknown as { rows: SettingRow[] };
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    container.rows[3]!.texts[0]!.change?.('First');
    container.rows[3]!.texts[0]!.change?.('Second');
    await flush();
    expect(writes.map(w => w.folder)).toEqual(['First']);
    resolvers.shift()?.();
    await flush();
    expect(writes.map(w => w.folder)).toEqual(['First', 'Second']);
    resolvers.shift()?.();
    await pendingSave;

    settingsFuture = true;
    container.rows[0]!.toggles[0]!.change?.(false);
    await flush();
    expect(writes).toHaveLength(2);
    expect(ui.notices).toEqual(['Settings could not be saved. Please try again.']);
  });
});

describe('stylesheet compatibility and specificity', () => {
  it('avoids clip-path and !important while keeping hidden overlays and sr-only status rules', () => {
    const css = readFileSync('styles.css', 'utf8');
    expect(css).not.toContain('clip-path');
    expect(css).not.toContain('!important');
    expect(css).toContain('html > body > button.six-dots-handle[type="button"][hidden]');
    expect(css).toContain('html > body > div.six-dots-drop[hidden]');
    expect(css).toContain('html > body > div.six-dots-preview[hidden]');
    expect(css).toContain('.six-dots-status');
    expect(css).toContain('overflow: hidden');
  });
});
