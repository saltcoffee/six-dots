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
export interface DeclarativeSettingDefinition {
  name: string;
  desc?: string;
  render: (setting: Setting) => void;
}
export class SixDotsSettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: SettingsOwner) { super(app, owner.plugin); }
  private save(): void {
    const { t } = this.owner;
    this.owner.refresh();
    void this.owner.save().catch(() => new Notice(t('saveFailed')));
  }
  getSettingDefinitions(): DeclarativeSettingDefinition[] {
    const { t } = this.owner;
    return [
      {
        name: t('enableDrag'),
        desc: t('enableDragHelp'),
        render: setting => {
          const { settings } = this.owner;
          setting.addToggle(control => control.setValue(settings.drag).onChange(value => { settings.drag = value; this.save(); }));
        },
      },
      {
        name: t('handleMode'),
        desc: t(Platform.isMobile ? 'mobileHandleHelp' : 'handleModeHelp'),
        render: setting => {
          const { settings, t: translate } = this.owner;
          setting.addDropdown(control => control.addOptions({ hover: translate('hover'), cursor: translate('cursor') })
            .setValue(Platform.isMobile ? 'cursor' : settings.handle)
            .setDisabled(Platform.isMobile)
            .onChange(value => { if (Platform.isMobile) return; settings.handle = value === 'cursor' ? 'cursor' : 'hover'; this.save(); }));
        },
      },
      {
        name: t('defaultCallout'),
        render: setting => {
          const { settings, t: translate } = this.owner;
          setting.addDropdown(control => control.addOptions({ note: translate('note'), info: translate('info'), tip: translate('tip'), warning: translate('warning') })
            .setValue(settings.callout)
            .onChange(value => { settings.callout = value as CalloutType; this.save(); }));
        },
      },
      {
        name: t('extractFolder'),
        desc: t('extractFolderHelp'),
        render: setting => {
          const { settings } = this.owner;
          setting.addText(control => control.setValue(settings.folder).onChange(value => { settings.folder = value.trim(); this.save(); }));
        },
      },
    ];
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const item of this.getSettingDefinitions()) {
      const setting = new Setting(containerEl).setName(item.name);
      if (item.desc) setting.setDesc(item.desc);
      item.render(setting);
    }
  }
}
