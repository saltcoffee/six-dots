import { Menu, Notice, TFile, TFolder, MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { foldedRanges } from '@codemirror/language';
import { convert, conversionReason } from '../domain/convert';
import { moveBy } from '../domain/move';
import { addBlockId, blockLinkReason, canonicalBlockLink } from '../domain/block-link';
import { defaultName, extractedText, extractionPlan, extractionReason, targetPath } from '../domain/extract';
import { BlockError } from '../domain/block';
import type { Format, Plan, Snapshot, Block } from '../domain/block';
import { runExtraction } from '../application/extraction';
import { dispatchPlan } from '../editor/dispatch';
import { targetValid } from '../editor/context';
import type { Target } from '../editor/context';
import { pointsToFile, rewriteLinks } from './links';
import type { Settings } from './settings';
import type { Message, Translate } from '../i18n';
import { ConfirmLinkModal, LinkModal, ExtractModal } from '../ui/dialogs';
import type { ManagedModal } from '../ui/dialogs';

export class Actions {
  alive = true;
  readonly committing = new Set<EditorView>();
  private modals = new Set<ManagedModal>();
  private menus = new Set<Menu>();
  private extracting = new Set<TFile>();
  constructor(readonly app: App, readonly t: Translate, readonly settings: () => Settings) {}

  notify(message: string): void { if (this.alive) new Notice(message); }
  error(error: unknown): void { this.notify(this.t(error instanceof BlockError ? error.reason : 'failed')); }
  valid(view: EditorView, target: Target): boolean { return this.alive && targetValid(view, target) && this.app.vault.getAbstractFileByPath(target.path) === target.file; }
  apply(view: EditorView, target: Target, plan: Plan | null, format?: Format): boolean {
    if (!this.valid(view, target)) { this.notify(this.t('changed')); return false; }
    if (!plan) return true;
    try {
      const result = this.commit(view, target, plan, format);
      if (result !== 'applied') this.notify(this.t(result === 'diverged' ? 'diverged' : 'changed'));
      return result === 'applied';
    } catch (error) { this.error(error); return false; }
  }
  private commit(view: EditorView, target: Target, plan: Plan, format?: Format) {
    this.committing.add(view);
    try { return dispatchPlan(view, target, plan, format); }
    finally { this.committing.delete(view); }
  }
  convert(view: EditorView, target: Target, format: Format): void {
    try { this.apply(view, target, convert(target.block, format, target.snapshot, view.state.selection.main.head), format); } catch (error) { this.error(error); }
  }
  folded(view: EditorView, block: Block): boolean {
    if (block.kind !== 'heading') return false;
    let folded = false;
    foldedRanges(view.state).between(block.from, block.to, () => { folded = true; });
    return folded;
  }
  move(view: EditorView, target: Target, direction: -1 | 1): void {
    if (this.folded(view, target.block)) { this.notify(this.t('foldHeading')); return; }
    try { this.apply(view, target, moveBy(target.snapshot, target.block, direction)); } catch (error) { this.error(error); }
  }
  showMenu(view: EditorView, target: Target, point: { x: number; y: number }, onHide: () => void): Menu {
    // Keep Escape and focus handling in the originating document, including popout windows.
    let escape = false;
    const onKey: EventListener = event => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
      escape = true; event.preventDefault(); event.stopImmediatePropagation(); menu.hide();
    };
    // Own Escape before host scopes can restore the handle's previous focus.
    const keyboardTarget = view.dom.ownerDocument.defaultView ?? view.dom.ownerDocument;
    keyboardTarget.addEventListener('keydown', onKey, true);
    const menu = new Menu().setUseNativeMenu(false), { block } = target, t = this.t;
    const heading = /^ {0,3}(#{1,6})(?:\s|$)/.exec(block.text)?.[1]?.length;
    const callout = /^\s*>\s*\[!([^\]]+)\]/.exec(block.text)?.[1]?.toLowerCase();
    const current = block.kind === 'paragraph' ? 'paragraph' : block.kind === 'heading' ? `h${heading}`
      : block.kind === 'list-item' && block.marker?.number === null ? block.marker.task === null ? 'bullet' : 'task'
      : block.kind === 'callout' ? `callout:${callout}` : block.kind;
    this.menus.add(menu);
    menu.onHide(() => {
      this.menus.delete(menu); keyboardTarget.removeEventListener('keydown', onKey, true);
      onHide();
      // Complete focus restoration after the menu has finished its dismissal.
      if (escape) queueMicrotask(() => { if (this.alive && view.dom.isConnected) view.focus(); });
    });
    const knownCallout = callout && ['note', 'info', 'tip', 'warning'].includes(callout) ? t(callout as 'note' | 'info' | 'tip' | 'warning') : callout;
    menu.addItem(item => item.setTitle(block.kind === 'callout' ? `${t('callout')}: ${knownCallout}` : t(block.kind)).setIsLabel(true));
    const formats: [Format, string][] = [
      ['paragraph', t('paragraph')], ...([1, 2, 3, 4, 5, 6] as const).map(level => [`h${level}` as Format, `${t('heading')} ${level}`] as [Format, string]),
      ['bullet', t('bullet')], ['task', t('task')], ['quote', t('quote')],
      ...(['note', 'info', 'tip', 'warning'] as const).map(type => [`callout:${type}` as Format, `${t('callout')}: ${t(type)}`] as [Format, string]),
    ];
    for (const [format, label] of formats) {
      const reason = conversionReason(block, format);
      // Unsupported families are omitted; restrictions within a supported family remain explained.
      if (reason === 'unsupported') continue;
      menu.addItem(item => item.setTitle(reason ? `${label} — ${t(reason)}` : label).setDisabled(!!reason).setChecked(current === format)
        .onClick(() => this.convert(view, target, format)));
    }
    menu.addSeparator();
    const linkReason = blockLinkReason(block);
    if (['paragraph', 'list-item', 'quote', 'callout'].includes(block.kind)) menu.addItem(item => item.setTitle(t(block.ownId ? 'copyLink' : 'createLink') + (linkReason ? ` — ${t(linkReason)}` : '')).setDisabled(!!linkReason).setIcon('link').onClick(() => this.copyLink(view, target, true)));
    const reason = extractionReason(block);
    menu.addItem(item => item.setTitle(reason ? `${t('extract')} — ${t(reason)}` : t('extract')).setDisabled(!!reason).setIcon('file-plus').onClick(() => this.extract(view, target)));
    menu.addSeparator();
    for (const direction of [-1, 1] as const) {
      let enabled = !this.folded(view, block);
      try { enabled &&= moveBy(target.snapshot, block, direction) !== null; } catch { enabled = false; }
      menu.addItem(item => item.setTitle(t(direction < 0 ? 'moveUp' : 'moveDown')).setIcon(direction < 0 ? 'arrow-up' : 'arrow-down').setDisabled(!enabled).onClick(() => this.move(view, target, direction)));
    }
    menu.showAtPosition(point, view.dom.ownerDocument);
    return menu;
  }
  private open(modal: ManagedModal): void {
    if (!this.alive) return;
    this.modals.add(modal); modal.onDismiss = () => this.modals.delete(modal); modal.open();
  }
  copyLink(view: EditorView, target: Target, explicit: boolean): void {
    if (!this.valid(view, target)) { this.notify(this.t('changed')); return; }
    const reason = blockLinkReason(target.block);
    if (reason) { this.notify(this.t(reason)); return; }
    if (!target.block.ownId && !explicit) {
      this.open(new ConfirmLinkModal(this.app, this.t, () => this.copyLink(view, target, true))); return;
    }
    try {
      const id = target.block.ownId?.value ?? this.generateId(target.snapshot);
      const link = canonicalBlockLink(target.path, id);
      if (!target.block.ownId && !this.apply(view, target, addBlockId(target.block, id))) return;
      const copy = async () => {
        if (!this.alive) return;
        const clipboard = view.dom.ownerDocument.defaultView?.navigator.clipboard;
        if (!clipboard) throw new Error('Clipboard unavailable');
        await clipboard.writeText(link);
        if (this.alive) this.notify(this.t('copied'));
      };
      void copy().catch(() => { if (this.alive) this.open(new LinkModal(this.app, this.t, link, copy)); });
    } catch (error) { this.error(error); }
  }
  private generateId(snapshot: Snapshot): string {
    let id: string;
    do { id = Array.from(crypto.getRandomValues(new Uint8Array(5)), byte => byte.toString(16).padStart(2, '0')).join(''); }
    while (snapshot.text.includes(`^${id}`));
    return id;
  }
  extract(view: EditorView, target: Target): void {
    if (!this.valid(view, target)) { this.notify(this.t('changed')); return; }
    const reason = extractionReason(target.block);
    if (reason) { this.notify(this.t(reason)); return; }
    const configured = this.settings().folder;
    const folder = configured === '/' ? '' : configured || target.path.split('/').slice(0, -1).join('/');
    let hasCreated = false;
    const modal = new ExtractModal(this.app, this.t, { name: defaultName(target.block.text, this.t('note')), folder, summary: target.block.text }, async (name, destination, active) => {
      const reject = (key: Message, retryable = true) => ({ message: this.t(key), retryable });
      if (hasCreated || !active() || !this.valid(view, target)) return reject('changed', false);
      let path: string, content: string;
      try {
        path = targetPath(destination, name);
        const parent = destination ? this.app.vault.getAbstractFileByPath(destination) : this.app.vault.getRoot();
        if (!(parent instanceof TFolder)) return reject('badPath');
        if (parent.children.some(file => file.name.toLocaleLowerCase() === path.split('/').at(-1)?.toLocaleLowerCase())) return reject('conflict');
      } catch { return reject('badPath'); }
      try { content = rewriteLinks(extractedText(target.block), target.path, path, (link, source) => this.app.metadataCache.getFirstLinkpathDest(link, source)); }
      catch { return reject('unresolvedLink'); }
      if (this.extracting.has(target.file)) return reject('working');
      this.extracting.add(target.file);
      let created: TFile | null = null;
      let verifiedStamp: string | null = null;
      try {
        const result = await runExtraction({
          create: async () => { hasCreated = true; created = await this.app.vault.create(path, content); },
          creationState: async () => {
            if (await this.app.vault.adapter.exists(path)) { hasCreated = true; return 'unknown'; }
            hasCreated = false; return 'absent';
          },
          valid: () => active() && this.valid(view, target),
          verifyTarget: async () => {
            const file = created as TFile | null;
            if (!file || this.app.vault.getAbstractFileByPath(path) !== file) return false;
            const stamp = `${file.stat.mtime}:${file.stat.size}`;
            if (await this.app.vault.read(file) !== content || stamp !== `${file.stat.mtime}:${file.stat.size}`) return false;
            verifiedStamp = stamp;
            return this.app.workspace.getLeavesOfType('markdown').every(leaf => !(leaf.view instanceof MarkdownView) || leaf.view.file !== file || leaf.view.editor.getValue() === content);
          },
          commit: () => {
            if (!created || !this.valid(view, target) || verifiedStamp !== `${created.stat.mtime}:${created.stat.size}`) return 'rejected';
            const link = this.app.fileManager.generateMarkdownLink(created, target.path);
            if (!pointsToFile(link, target.path, path, (value, source) => this.app.metadataCache.getFirstLinkpathDest(value, source))) return 'rejected';
            return this.commit(view, target, extractionPlan(target.block, link));
          },
        });
        if (this.alive && (created || result === 'creation-unknown')) this.extractionNotice(view.dom.ownerDocument, path,
          result === 'creation-unknown' ? 'unknownCreate' : result === 'success' ? 'extracted' : result === 'diverged' ? 'diverged' : result === 'target-changed' ? 'targetChanged' : 'partial');
        if (result === 'success') return null;
        if (result === 'creation-unknown') return { message: `${this.t('unknownCreate')} ${path}`, retryable: false };
        return reject(result === 'create-failed' ? 'failed' : result === 'diverged' ? 'diverged' : result === 'target-changed' ? 'targetChanged' : 'partial',
          result === 'create-failed' && active() && this.valid(view, target));
      } finally { this.extracting.delete(target.file); }
    });
    this.open(modal);
  }
  private extractionNotice(doc: Document, path: string, key: 'extracted' | 'partial' | 'targetChanged' | 'diverged' | 'unknownCreate'): void {
    const fragment = doc.createDocumentFragment();
    fragment.createEl('span', { text: `${this.t(key)} ${path} ` });
    fragment.createEl('a', { text: this.t('openNote'), href: '#' }).addEventListener('click', event => {
      event.preventDefault(); const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file);
      else this.notify(this.t('missingNote'));
    });
    new Notice(fragment, key === 'extracted' ? 8000 : 0);
  }
  destroy(): void {
    this.alive = false;
    for (const menu of this.menus) menu.hide();
    for (const modal of this.modals) modal.close();
    this.menus.clear(); this.modals.clear();
  }
}
