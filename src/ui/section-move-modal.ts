import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { Translate } from '../i18n';
import type { SectionMove } from '../domain/section';
import type { Snapshot } from '../domain/block';
import { ManagedModal } from './dialogs';

export class SectionMoveModal extends ManagedModal {
  private status!: HTMLParagraphElement;
  private confirm!: HTMLButtonElement;
  private resizeCleanup = () => undefined;
  constructor(app: App, private t: Translate, private snapshot: Snapshot, private move: SectionMove,
    private hidden: boolean, private submit: () => void) {
    super(app);
    // A stale dialog must never replay the editor selection captured when Obsidian opened it.
    this.shouldRestoreSelection = false;
  }
  onOpen(): void {
    this.modalEl.classList.add('six-dots-section-modal');
    this.setTitle(this.t('sectionMoveTitle'));
    const summary = this.contentEl.createEl('div', { cls: 'six-dots-section-summary' });
    for (const [key, section] of [['sectionSource', this.move.source], ['sectionTarget', this.move.target]] as const) {
      const from = this.snapshot.text.slice(0, section.from).split('\n').length;
      const to = this.snapshot.text.slice(0, Math.max(section.from, section.to - 1)).split('\n').length;
      summary.createEl('h3', { text: this.t(key) });
      summary.createEl('p', { text: `H${section.heading.level} · ${section.heading.title}`, cls: 'six-dots-section-heading' });
      summary.createEl('p', { text: `${this.t('sectionRange')}: ${from}–${to} · ${this.t('sectionLines')}: ${to - from + 1} · ${this.t('sectionSubheadings')}: ${section.childHeadingCount}` });
    }
    if (this.hidden) summary.createEl('p', { text: this.t('sectionHidden'), cls: 'six-dots-section-warning' });
    summary.createEl('h3', { text: this.t('sectionOrder') });
    const order = this.move.source.from < this.move.target.from ? [this.move.target, this.move.source] : [this.move.source, this.move.target];
    const list = summary.createEl('ol');
    for (const section of order) list.createEl('li', { text: `H${section.heading.level} · ${section.heading.title}` });
    this.status = this.contentEl.createEl('p', { text: this.t('sectionPreparing'), attr: { role: 'status', 'aria-live': 'polite' } });
    const controls = this.contentEl.createEl('div', { cls: 'six-dots-move-controls' });
    const cancel = controls.createEl('button', { text: this.t('cancel'), attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    this.confirm = controls.createEl('button', { text: this.t('sectionConfirm'), cls: 'mod-cta', attr: { type: 'button' } });
    this.confirm.disabled = true;
    this.confirm.addEventListener('click', () => { if (!this.confirm.disabled) { this.confirm.disabled = true; this.submit(); } });
    const win = this.modalEl.ownerDocument.defaultView, viewport = win?.visualViewport;
    const resize = () => {
      const height = viewport?.height ?? win?.innerHeight ?? 600;
      this.modalEl.style.maxHeight = `${Math.max(0, height - 24)}px`;
      this.modalEl.style.maxWidth = `${Math.max(0, (viewport?.width ?? win?.innerWidth ?? 600) - 24)}px`;
    };
    viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize); win?.addEventListener('resize', resize);
    this.resizeCleanup = () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); win?.removeEventListener('resize', resize); };
    resize();
    // No text input or editor focus on phones: opening this dialog does not request a keyboard.
    if (!Platform.isMobile) cancel.focus();
  }
  ready(): void { this.status.setText(''); this.confirm.disabled = false; }
  expire(message: string): void { this.status.setText(message); this.confirm.disabled = true; }
  onClose(): void { this.resizeCleanup(); super.onClose(); }
}

/** Legacy moves prepare without a confirmation dialog; cancellation stays visible and keyboard accessible. */
export class MoveProgress {
  private element: HTMLDivElement;
  private status: HTMLSpanElement;
  private cleanup: () => void;
  constructor(doc: Document, t: Translate, cancel: () => void) {
    this.element = doc.createElement('div'); this.element.className = 'six-dots-move-progress';
    this.status = doc.createElement('span'); this.status.textContent = t('movePreparing');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = t('cancel');
    button.addEventListener('click', cancel);
    this.element.append(this.status, button); doc.body.append(this.element);
    const win = doc.defaultView, viewport = win?.visualViewport;
    const resize = () => {
      const bottom = viewport && win ? Math.max(12, win.innerHeight - viewport.offsetTop - viewport.height + 12) : 12;
      this.element.style.bottom = `max(${bottom}px, env(safe-area-inset-bottom))`;
    };
    viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize); win?.addEventListener('resize', resize);
    resize();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } };
    doc.addEventListener('keydown', escape, true);
    this.cleanup = () => {
      doc.removeEventListener('keydown', escape, true);
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); win?.removeEventListener('resize', resize);
    };
  }
  expire(message: string): void { this.status.textContent = message; }
  close(): void { this.cleanup(); this.element.remove(); }
}
