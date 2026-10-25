import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { Translate } from '../i18n';
import { targetPath } from '../domain/extract';

export class ManagedModal extends Modal {
  constructor(app: App) { super(app); this.modalEl.classList.add('six-dots-modal'); }
  onDismiss: () => void = () => undefined;
  onClose(): void { this.contentEl.empty(); this.onDismiss(); }
}
export class ConfirmLinkModal extends ManagedModal {
  constructor(app: App, private t: Translate, private confirm: () => void) { super(app); }
  onOpen(): void {
    this.setTitle(this.t('createLink'));
    this.contentEl.createEl('p', { text: this.t('createLinkHelp') });
    new Setting(this.contentEl).addButton(button => button.setButtonText(this.t('cancel')).onClick(() => this.close()))
      .addButton(button => button.setButtonText(this.t('confirmCreate')).setCta().onClick(() => { this.close(); this.confirm(); }));
  }
}

export class LinkModal extends ManagedModal {
  constructor(app: App, private t: Translate, private link: string, private copy: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.setTitle(this.t('copyLink'));
    const status = this.contentEl.createEl('p', { text: this.t('copyFailed'), attr: { role: 'status' } });
    const input = this.contentEl.createEl('textarea', { cls: 'six-dots-link', attr: { 'aria-label': this.t('linkText'), readonly: '' } });
    input.value = this.link;
    input.addEventListener('click', () => input.select());
    new Setting(this.contentEl).addButton(button => button.setButtonText(this.t('close')).onClick(() => this.close()))
      .addButton(button => button.setButtonText(this.t('retryCopy')).setCta().onClick(async () => {
        try { await this.copy(); this.close(); } catch { status.setText(this.t('copyFailed')); input.focus(); input.select(); }
      }));
    input.focus(); input.select();
  }
}

export interface ExtractDialogData { name: string; folder: string; summary: string }
export interface ExtractDialogError { message: string; retryable: boolean }
export class ExtractModal extends ManagedModal {
  cancelled = false;
  private busy = false;
  constructor(app: App, private t: Translate, private data: ExtractDialogData,
    private submit: (name: string, folder: string, active: () => boolean) => Promise<ExtractDialogError | null>) { super(app); }
  onOpen(): void {
    this.setTitle(this.t('extract'));
    this.contentEl.createEl('p', { text: this.t('extractHelp') });
    this.contentEl.createEl('pre', { text: this.data.summary.slice(0, 240), cls: 'six-dots-summary' });
    const destination = this.contentEl.createEl('p', { cls: 'six-dots-path' });
    const status = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
    const preview = () => {
      try { destination.setText(`${this.t('destination')}: ${targetPath(this.data.folder, this.data.name)}`); }
      catch { destination.setText(this.t('badPath')); }
    };
    const fields: HTMLInputElement[] = [];
    new Setting(this.contentEl).setName(this.t('fileName')).addText(control => {
      fields.push(control.inputEl); control.inputEl.setAttribute('aria-label', this.t('fileName'));
      control.setValue(this.data.name).onChange(value => { this.data.name = value; preview(); });
    });
    new Setting(this.contentEl).setName(this.t('folder')).setDesc(this.t('rootFolder') + ': /').addText(control => {
      fields.push(control.inputEl); control.inputEl.setAttribute('aria-label', this.t('folder'));
      control.setValue(this.data.folder || '/').onChange(value => { this.data.folder = value.trim() === '/' ? '' : value.trim(); preview(); });
    });
    new Setting(this.contentEl).addButton(button => button.setButtonText(this.t('cancel')).onClick(() => this.close()))
      .addButton(button => button.setButtonText(this.t('extract')).setCta().onClick(async () => {
        if (this.busy) return;
        this.busy = true; button.setDisabled(true).setButtonText(this.t('working'));
        fields.forEach(field => field.disabled = true);
        let error: ExtractDialogError | null;
        try { error = await this.submit(this.data.name, this.data.folder, () => !this.cancelled); }
        catch { error = { message: this.t('failed'), retryable: false }; }
        if (this.cancelled) return;
        if (error === null) { this.close(); return; }
        status.setText(error.message + (error.retryable ? '' : ' ' + this.t('reviewBeforeRetry')));
        this.busy = !error.retryable;
        fields.forEach(field => field.disabled = !error.retryable);
        button.setDisabled(!error.retryable).setButtonText(this.t('extract'));
      }));
    preview();
  }
  onClose(): void { this.cancelled = true; super.onClose(); }
}
