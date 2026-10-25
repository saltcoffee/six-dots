import { PluginSettingTab, Setting, Notice, Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { CalloutType } from '../domain/block';
import type { Translate } from '../i18n';

export interface Settings {
  schemaVersion: number;
  drag: boolean;
  handle: 'hover' | 'cursor';
  callout: CalloutType;
  folder: string;
}
export const defaults: Settings = { schemaVersion: 1, drag: true, handle: 'hover', callout: 'note', folder: '' };
export function decodeSettings(value: unknown): { settings: Settings; invalid: boolean; future: boolean } {
  if (value === null || value === undefined) return { settings: { ...defaults }, invalid: false, future: false };
  if (typeof value !== 'object') return { settings: { ...defaults }, invalid: true, future: false };
  const input = value as Record<string, unknown>;
  const future = typeof input.schemaVersion === 'number' && input.schemaVersion > 1;
  const settings: Settings = {
    schemaVersion: 1,
    drag: typeof input.drag === 'boolean' ? input.drag : defaults.drag,
    handle: input.handle === 'hover' || input.handle === 'cursor' ? input.handle : defaults.handle,
    callout: ['note', 'info', 'tip', 'warning'].includes(String(input.callout)) ? input.callout as CalloutType : defaults.callout,
    folder: typeof input.folder === 'string' && !input.folder.split('/').includes('..') ? input.folder : defaults.folder,
  };
  const invalid = Object.entries(settings).some(([key, data]) => key in input && input[key] !== data);
  return { settings, invalid, future };
}

interface SettingsOwner {
  settings: Settings;
  save(): Promise<void>;
  refresh(): void;
  t: Translate;
  plugin: import('obsidian').Plugin;
}
export class SixDotsSettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: SettingsOwner) { super(app, owner.plugin); }
  display(): void {
    const { containerEl } = this, { t, settings } = this.owner;
    containerEl.empty();
    const save = () => { this.owner.refresh(); void this.owner.save().catch(() => new Notice(t('saveFailed'))); };
    new Setting(containerEl).setName(t('enableDrag')).setDesc(t('enableDragHelp')).addToggle(control => control.setValue(settings.drag).onChange(value => { settings.drag = value; save(); }));
    new Setting(containerEl).setName(t('handleMode')).setDesc(t(Platform.isMobile ? 'mobileHandleHelp' : 'handleModeHelp')).addDropdown(control => control.addOptions({ hover: t('hover'), cursor: t('cursor') }).setValue(Platform.isMobile ? 'cursor' : settings.handle).setDisabled(Platform.isMobile).onChange(value => { settings.handle = value === 'cursor' ? 'cursor' : 'hover'; save(); }));
    new Setting(containerEl).setName(t('defaultCallout')).addDropdown(control => control.addOptions({ note: t('note'), info: t('info'), tip: t('tip'), warning: t('warning') }).setValue(settings.callout).onChange(value => { settings.callout = value as CalloutType; save(); }));
    new Setting(containerEl).setName(t('extractFolder')).setDesc(t('extractFolderHelp')).addText(control => control.setValue(settings.folder).onChange(value => { settings.folder = value.trim(); save(); }));
  }
}
