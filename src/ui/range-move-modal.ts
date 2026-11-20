import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { Text } from '@codemirror/state';
import type { Translate } from '../i18n';
import type { RangeMove } from '../domain/range-move';
import type { Snapshot, Span } from '../domain/block';
import { ManagedModal } from './dialogs';

function lineOf(text: string, offset: number, doc?: Text): number {
  if (doc) return doc.lineAt(Math.max(0, Math.min(offset, doc.length))).number;
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) if (text[index] === '\n') line++;
  return line;
}

function snippet(text: string, span: Span): { text: string; omitted: number } {
  const value = text.slice(span.from, span.to).replace(/\s+/g, ' ').trim();
  return value.length > 60 ? { text: `${value.slice(0, 60)}…`, omitted: value.length - 60 } : { text: value, omitted: 0 };
}

function spanLines(text: string, span: Span, doc?: Text): string {
  return `${lineOf(text, span.from, doc)}–${lineOf(text, Math.max(span.from, span.to - 1), doc)}`;
}

export class RangeMoveModal extends ManagedModal {
  private status!: HTMLParagraphElement;
  private confirm!: HTMLButtonElement;
  private resizeCleanup = () => undefined;
  constructor(app: App, private t: Translate, private snapshot: Snapshot, private move: RangeMove,
    private original: Span, private hidden: boolean, private submit: () => void, private path: string, private doc?: Text) {
    super(app);
    // A stale dialog must never replay the editor selection captured when Obsidian opened it.
    this.shouldRestoreSelection = false;
  }
  onOpen(): void {
    this.modalEl.classList.add('six-dots-section-modal', 'six-dots-range-modal');
    this.setTitle(this.t('rangeMoveTitle'));
    const text = this.snapshot.text;
    const summary = this.contentEl.createDiv({ cls: 'six-dots-section-summary' });
    const direction = this.move.direction < 0 ? this.t('rangeDirUp') : this.t('rangeDirDown');
    const units = this.move.source.units;
    const first = units[0]!, last = units.at(-1)!;
    summary.createEl('h3', { text: this.t('rangeSource') });
    summary.createEl('p', { text: this.path });
    summary.createEl('p', { text: `${this.t('rangeDirection')}: ${direction} · ${this.t('rangeLineRange')}: ${lineOf(text, first.from, this.doc)}–${lineOf(text, Math.max(last.from, last.to - 1), this.doc)}` });
    summary.createEl('p', { text: `${this.t('rangeUnits')}: ${units.length} · ${this.t('rangeDescendants')}: ${units.reduce((sum, unit) => sum + unit.descendantCount, 0)}` });
    const firstText = snippet(text, first), lastText = snippet(text, last);
    summary.createEl('p', { cls: 'six-dots-section-heading', text: `${this.t('rangeEndpoints')}: ${this.t(first.kind)} · ${firstText.text} — ${this.t(last.kind)} · ${lastText.text}` });
    const extra = this.extraSpans();
    if (extra.length) {
      summary.createEl('h3', { text: this.t('rangeExtra') });
      for (const span of extra) {
        const info = snippet(text, span);
        summary.createEl('p', { text: `${this.t('rangeExtraLines')} ${spanLines(text, span, this.doc)} · ${info.text}${info.omitted ? ` · ${this.t('rangeOmitted')}: ${info.omitted}` : ''}` });
      }
    }
    if (this.hidden) summary.createEl('p', { text: this.t('rangeHidden'), cls: 'six-dots-section-warning' });
    summary.createEl('h3', { text: this.t('rangeTarget') });
    const targetText = snippet(text, this.move.target);
    summary.createEl('p', { cls: 'six-dots-section-heading', text: `${this.t(this.move.target.kind)} · ${targetText.text}` });
    summary.createEl('p', { text: `${this.t('rangeLineRange')}: ${spanLines(text, this.move.target, this.doc)}${this.move.target.descendantCount ? ` · ${this.t('rangeDescendants')}: ${this.move.target.descendantCount}` : ''}${targetText.omitted ? ` · ${this.t('rangeOmitted')}: ${targetText.omitted}` : ''}` });
    if (this.move.numberingChanges.length) {
      summary.createEl('h3', { text: this.t('rangeNumberingExtra') });
      for (const change of this.move.numberingChanges) summary.createEl('p', { text: `${this.t('rangeExtraLines')} ${lineOf(text, change.from, this.doc)} · ${change.before} → ${change.after}` });
    }
    summary.createEl('h3', { text: this.t('rangeOrder') });
    const order = this.move.direction < 0 ? [...units, this.move.target] : [this.move.target, ...units];
    const list = summary.createEl('ol');
    const indices = order.length <= 12 ? order.map((_, index) => index)
      : [0, 1, 2, 3, 4, -1, ...Array.from({ length: 5 }, (_, index) => order.length - 5 + index)];
    for (const index of indices) {
      if (index < 0) {
        list.createEl('li', { text: `${this.t('rangeOrderOmitted')}: ${order.length - 10}`, cls: 'six-dots-order-omitted' });
      } else {
        const unit = order[index]!;
        list.createEl('li', { text: `${this.t(unit.kind)} · ${snippet(text, unit).text}`, attr: { value: String(index + 1) } });
      }
    }
    this.status = this.contentEl.createEl('p', { text: this.t('rangePreparing'), attr: { role: 'status', 'aria-live': 'polite' } });
    const controls = this.contentEl.createDiv({ cls: 'six-dots-move-controls' });
    const cancel = controls.createEl('button', { text: this.t('cancel'), attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    this.confirm = controls.createEl('button', { text: this.t(this.move.direction < 0 ? 'rangeConfirmUp' : 'rangeConfirmDown'), cls: 'mod-cta', attr: { type: 'button' } });
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
    if (!Platform.isMobile) cancel.focus({ preventScroll: true });
  }
  ready(): void { this.status.setText(''); this.confirm.disabled = false; }
  expire(message: string): void { this.status.setText(message); this.confirm.disabled = true; }
  onClose(): void { this.resizeCleanup(); super.onClose(); }
  private extraSpans(): readonly Span[] {
    const source = this.move.source;
    const spans: Span[] = [];
    if (this.original.from > source.from && this.original.from < source.to) spans.push({ from: source.from, to: this.original.from });
    if (this.original.to > source.from && this.original.to < source.to) spans.push({ from: this.original.to, to: source.to });
    return spans.filter(span => span.to > span.from);
  }
}
