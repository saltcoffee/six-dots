import { Plugin, getLanguage, Notice, editorInfoField } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { Actions } from './obsidian/actions';
import { decodeSettings, defaults, SixDotsSettingsTab } from './obsidian/settings';
import type { Settings } from './obsidian/settings';
import { translator } from './i18n';
import { Controller, editorExtension } from './editor/controller';
import { editable, tableFocused } from './editor/context';
import { conversionReason } from './domain/convert';
import { extractionReason } from './domain/extract';
import { siblingBlocks } from './domain/block';
import { blockLinkReason } from './domain/block-link';

export default class SixDots extends Plugin {
  settings: Settings = { ...defaults };
  private controllers = new Map<EditorView, Controller>();
  private actions!: Actions;
  private settingsFuture = false;
  private pendingSave: Promise<void> = Promise.resolve();
  readonly t = (key: Parameters<ReturnType<typeof translator>>[0]) => translator(getLanguage())(key);

  async onload(): Promise<void> {
    let data: unknown = null;
    try { data = await this.loadData(); } catch { new Notice(this.t('invalidSettings')); }
    const decoded = decodeSettings(data);
    this.settings = decoded.settings; this.settingsFuture = decoded.future;
    if (decoded.future) new Notice(this.t('futureSettings'));
    else if (decoded.invalid) new Notice(this.t('invalidSettings'));
    this.actions = new Actions(this.app, this.t, () => this.settings);
    this.registerEditorExtension(editorExtension(this.actions, this.controllers));
    this.registerEvent(this.app.vault.on('rename', () => this.controllers.forEach(controller => controller.refresh())));
    this.addSettingTab(new SixDotsSettingsTab(this.app, { plugin: this, settings: this.settings, t: this.t,
      save: () => this.saveSettings(), refresh: () => this.controllers.forEach(controller => controller.refresh()) }));
    const commands = [
      ['open-block-actions', 'actions', (controller: Controller) => controller.openMenu(true)],
      ['move-block-up', 'moveUp', (controller: Controller) => { const target = controller.current(); if (target) this.actions.move(controller.view, target, -1); }],
      ['move-block-down', 'moveDown', (controller: Controller) => { const target = controller.current(); if (target) this.actions.move(controller.view, target, 1); }],
      ['convert-to-task', 'convertTask', (controller: Controller) => { const target = controller.current(); if (target) this.actions.convert(controller.view, target, 'task'); }],
      ['convert-to-callout', 'convertCallout', (controller: Controller) => { const target = controller.current(); if (target && target.block.kind !== 'callout') this.actions.convert(controller.view, target, `callout:${this.settings.callout}`); }],
      ['copy-block-link', 'copyLink', (controller: Controller) => { const target = controller.current(); if (target) this.actions.copyLink(controller.view, target, false); }],
      ['extract-block', 'extract', (controller: Controller) => { const target = controller.current(); if (target) this.actions.extract(controller.view, target); }],
    ] as const;
    for (const [id, name, run] of commands) this.addCommand({ id, name: this.t(name), editorCheckCallback: (checking, editor) => {
      const entry = [...this.controllers].find(([view]) => view.state.field(editorInfoField, false)?.editor === editor && editable(view) && !tableFocused(view));
      if (!entry) return false;
      if (entry[1].cache.snapshot) {
        const target = entry[1].peek();
        if (!target) return false;
        if (id === 'convert-to-task' && conversionReason(target.block, 'task')) return false;
        if (id === 'convert-to-callout' && (target.block.kind === 'callout' || conversionReason(target.block, `callout:${this.settings.callout}`))) return false;
        if (id === 'extract-block' && extractionReason(target.block)) return false;
        if (id === 'copy-block-link' && blockLinkReason(target.block)) return false;
        if (id === 'move-block-up' || id === 'move-block-down') {
          const siblings = siblingBlocks(target.snapshot, target.block), index = siblings.indexOf(target.block);
          if (!siblings[index + (id === 'move-block-up' ? -1 : 1)] || this.actions.folded(entry[0], target.block)) return false;
        }
      }
      if (!checking) run(entry[1]);
      return true;
    } });
  }
  private saveSettings(): Promise<void> {
    if (this.settingsFuture) return Promise.reject(new Error('Unsupported settings schema'));
    const snapshot = { ...this.settings };
    const save = this.pendingSave.catch(() => undefined).then(() => this.saveData(snapshot));
    this.pendingSave = save; return save;
  }
  onunload(): void {
    this.actions?.destroy();
    this.controllers.forEach(controller => controller.destroy());
  }
}
