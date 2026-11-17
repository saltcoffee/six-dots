import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { EditorSelection } from '@codemirror/state';
import { BlockError } from '../domain/block';
import type { Plan, Span } from '../domain/block';
import { moveSection } from '../domain/section';
import type { SectionMove } from '../domain/section';
import { resolveRange } from '../domain/block-range';
import { planRangeMove, rangeMoveReason } from '../domain/range-move';
import type { RangeMove } from '../domain/range-move';
import { contextFor, fileFor, rangeEditable, tableFocused } from '../editor/context';
import type { MoveContext, Target } from '../editor/context';
import { dispatchPrepared, MovePreparation, preparedMove } from '../editor/move-preparation';
import type { PreparedMove } from '../editor/move-preparation';
import { cursorHidden, historyFoldNotice, invertSectionMapping, mapSectionFolds, mapSectionSelection, readFolds, sameFolds, transactionSectionMapping } from '../editor/section-folds';
import { peerSectionMove, SectionPeers } from '../editor/section-peers';
import type { SnapshotCache } from '../editor/snapshot-cache';
import type { Message, Translate } from '../i18n';
import { MoveProgress, SectionMoveModal } from '../ui/section-move-modal';
import { RangeMoveModal } from '../ui/range-move-modal';
import { sectionAnchorReason } from './section-anchors';

interface Host {
  readonly committing: Set<EditorView>;
  valid(view: EditorView, target: MoveContext): boolean;
  validContext(view: EditorView, target: MoveContext): boolean;
  notify(message: string): void;
  error(error: unknown): void;
  preserveLineEndings(view: EditorView): void;
}
interface Editor { cache: SnapshotCache; rebuild: () => void; refresh: () => void }
interface Capture { selection: EditorSelection; folds: readonly Span[] }
type Kind = 'block' | 'section' | 'range';
interface Job {
  readonly view: EditorView;
  readonly target: MoveContext;
  readonly kind: Kind;
  readonly preparation: MovePreparation;
  readonly captures: ReadonlyMap<EditorView, Capture>;
  readonly ui: SectionMoveModal | RangeMoveModal | MoveProgress;
  readonly cleanup: () => void;
  expired: boolean;
  consuming: boolean;
  prepared?: PreparedMove;
}

export class Moves {
  private alive = true;
  private editors = new Map<EditorView, Editor>();
  private jobs = new Map<EditorView, Job>();
  private staged = new Map<EditorView, PreparedMove>();
  private peers: SectionPeers;
  constructor(private app: App, private t: Translate, private host: Host) {
    this.peers = new SectionPeers(() => [...this.editors.keys()], () => this.host.notify(this.t('viewDiverged')));
  }
  attach(view: EditorView, editor: Editor): void { this.editors.set(view, editor); }
  detach(view: EditorView): void {
    this.finish(this.jobs.get(view));
    for (const job of this.jobs.values()) if (job.captures.has(view)) this.expire(job);
    this.editors.delete(view); this.staged.delete(view);
  }
  private related(view: EditorView): readonly EditorView[] {
    return [view, ...[...this.editors.keys()].filter(peer => peer !== view && fileFor(peer) === fileFor(view))];
  }
  reason(view: EditorView, target: Target, direction: -1 | 1): Message | null {
    if (!this.host.valid(view, target)) return 'changed';
    if (target.block.kind !== 'heading') return 'unsupported';
    const reason = sectionAnchorReason(target.snapshot);
    if (reason) return reason;
    if (this.related(view).some(peer => !peer.state.doc.eq(target.doc))) return 'changed';
    if (this.related(view).some(peer => cursorHidden(peer.state))) return 'hiddenCursor';
    try {
      const move = moveSection(target.snapshot, target.block.from, direction);
      for (const peer of this.related(view)) mapSectionSelection(peer.state.selection, { ranges: move.mappings });
      return null;
    }
    catch (error) { return error instanceof BlockError ? error.reason : 'failed'; }
  }
  section(view: EditorView, target: Target, direction: -1 | 1): void {
    const reason = this.reason(view, target, direction);
    if (reason) { this.host.notify(this.t(reason)); return; }
    try { const section = moveSection(target.snapshot, target.block.from, direction); this.start(view, target, section.plan, { section }); }
    catch (error) { this.host.error(error); }
  }
  block(view: EditorView, target: Target, plan: Plan | null): void {
    if (plan) this.start(view, target, plan);
  }
  /** Availability of an explicit multi-block move in one direction; null means it may run. */
  rangeReason(view: EditorView, direction: -1 | 1): Message | null {
    if (tableFocused(view)) return 'unsupported';
    if (!rangeEditable(view)) return 'rangeSelection';
    const snapshot = this.editors.get(view)?.cache.snapshot;
    if (!snapshot || snapshot.text !== view.state.doc.toString()) return 'preparing';
    if (this.related(view).some(peer => peer.state.doc.toString() !== snapshot.text)) return 'changed';
    const selection = view.state.selection.main;
    try {
      const resolution = resolveRange(snapshot, selection.from, selection.to);
      return rangeMoveReason(resolution, direction, snapshot);
    } catch (error) { return error instanceof BlockError ? error.reason : 'failed'; }
  }
  range(view: EditorView, direction: -1 | 1): void {
    const reason = this.rangeReason(view, direction);
    if (reason) { this.host.notify(this.t(reason)); return; }
    const snapshot = this.editors.get(view)?.cache.snapshot;
    const target = snapshot && snapshot.text === view.state.doc.toString() ? contextFor(view, snapshot) : null;
    if (!snapshot || !target) { this.host.notify(this.t('preparing')); return; }
    try {
      const selection = view.state.selection.main;
      const resolution = resolveRange(snapshot, selection.from, selection.to);
      const move = planRangeMove(snapshot, resolution, direction);
      this.start(view, target, move.plan, { range: move });
    } catch (error) { this.host.error(error); }
  }
  private start(view: EditorView, target: MoveContext, plan: Plan, options: { section?: SectionMove; range?: RangeMove } = {}): void {
    const { section, range } = options;
    this.finish(this.jobs.get(view));
    const valid = range ? this.host.validContext(view, target) : this.host.valid(view, target);
    if (!valid) { this.host.notify(this.t('changed')); return; }
    const captures = new Map(this.related(view).map(peer => [peer, { selection: peer.state.selection, folds: readFolds(peer.state) }]));
    const cancel = () => { if (this.jobs.get(view) === job) { this.finish(job); this.restoreFocus(job); } };
    const region = range?.plan.edits[0];
    const hidden = section
      ? [...captures.values()].some(c => c.folds.some(f => f.from < section.source.to && f.to > section.source.from
        || f.from < section.target.to && f.to > section.target.from))
      : range && region ? [...captures.values()].some(c => c.folds.some(f => f.from < region.to && f.to > region.from)) : false;
    const kind: Kind = section ? 'section' : range ? 'range' : 'block';
    const original = view.state.selection.main;
    const ui = section ? new SectionMoveModal(this.app, this.t, target.snapshot, section, !!hidden, () => this.submit(job))
      : range ? new RangeMoveModal(this.app, this.t, target.snapshot, range, original, !!hidden, () => this.submit(job), target.path)
      : new MoveProgress(view.dom.ownerDocument, this.t, cancel);
    const doc = view.dom.ownerDocument, win = doc.defaultView;
    const blur = () => this.expire(job);
    const visibility = () => { if (doc.visibilityState === 'hidden') this.expire(job); };
    const composition = () => this.expire(job);
    win?.addEventListener('blur', blur); doc.addEventListener('visibilitychange', visibility);
    view.dom.addEventListener('compositionstart', composition);
    const job: Job = { view, target, kind, captures, ui, preparation: new MovePreparation(), expired: false, consuming: false,
      cleanup: () => { win?.removeEventListener('blur', blur); doc.removeEventListener('visibilitychange', visibility); view.dom.removeEventListener('compositionstart', composition); } };
    this.jobs.set(view, job);
    if (!(ui instanceof MoveProgress)) { ui.onDismiss = cancel; ui.open(); }
    try {
      job.preparation.prepare(view, target, plan, section, move => {
        if (!this.active(job)) { this.expire(job); return; }
        try {
          if (move.range && move.mapping) {
            const inverse = invertSectionMapping(move.mapping);
            for (const [peer, capture] of captures) {
              if (cursorHidden(peer.state)) throw new BlockError('hiddenCursor');
              mapSectionFolds(capture.folds, move.mapping, move.expected.length);
              // The source's original partial selection is restored by its own CM history.
              if (peer === view) continue;
              let mapped;
              try { mapped = mapSectionSelection(capture.selection, move.mapping); }
              catch { throw new BlockError('rangeSelectionRoundTrip'); }
              if (mapped.ranges.length !== capture.selection.ranges.length) {
                throw new BlockError('rangeSelectionRoundTrip');
              }
              try {
                const restored = mapSectionSelection(mapped, inverse);
                if (!restored.eq(capture.selection, true) || !mapSectionSelection(restored, move.mapping).eq(mapped, true)) {
                  throw new BlockError('rangeSelectionRoundTrip');
                }
              }
              catch { throw new BlockError('rangeSelectionRoundTrip'); }
            }
          } else if (move.mapping) for (const [peer, capture] of captures) {
            if (cursorHidden(peer.state)) throw new BlockError('hiddenCursor');
            mapSectionFolds(capture.folds, move.mapping, move.expected.length);
          }
          job.prepared = move;
          if (ui instanceof MoveProgress) this.submit(job); else ui.ready();
        } catch (error) { this.fail(job, error); }
      }, error => this.fail(job, error), range);
    } catch (error) { this.fail(job, error); }
  }
  private active(job: Job): boolean {
    const valid = job.kind === 'range' ? this.host.validContext(job.view, job.target) : this.host.valid(job.view, job.target as Target);
    return this.alive && this.jobs.get(job.view) === job && !job.expired && !job.consuming && valid
      && [...job.captures].every(([peer, capture]) => peer.dom.isConnected && fileFor(peer) === job.target.file
        && peer.state.doc.eq(job.target.doc) && peer.state.selection.eq(capture.selection, true) && sameFolds(readFolds(peer.state), capture.folds));
  }
  private submit(job: Job): void {
    if (!this.active(job) || !job.prepared) { this.expire(job); return; }
    const move = job.prepared, editor = this.editors.get(job.view);
    job.consuming = true; this.host.committing.add(job.view);
    try {
      this.host.preserveLineEndings(job.view);
      let result = dispatchPrepared(job.view, move);
      if (result === 'applied' && this.alive && this.staged.get(job.view) === move && editor) {
        editor.cache.adopt(move.candidate); editor.refresh();
      } else {
        if (result === 'applied') result = 'viewDiverged';
        if (this.alive) editor?.rebuild();
      }
      if (result !== 'applied') this.host.notify(this.t(result === 'rejected' ? (job.kind === 'section' ? 'sectionExpired' : 'rangeExpired') : result));
      else if (job.kind === 'section') this.host.notify(this.t('sectionMoved'));
      else if (job.kind === 'range') this.host.notify(this.t('rangeMoved'));
    } catch (error) { if (this.alive) editor?.rebuild(); this.host.error(error); }
    finally {
      this.staged.delete(job.view); this.host.committing.delete(job.view); this.finish(job); this.restoreFocus(job);
    }
  }
  /** Called during the owned transaction. Invalidate the old snapshot, publish only after postchecks. */
  update(update: ViewUpdate): boolean {
    this.peers.update(update);
    for (const tr of update.transactions) {
      if (tr.annotation(historyFoldNotice)) this.host.notify(this.t('historyUnfolded'));
      const mapping = transactionSectionMapping(tr);
      if (mapping && !tr.annotation(peerSectionMove)) this.peers.arm(update.view, tr.startState.doc, tr.newDoc, mapping);
    }
    for (const job of this.jobs.values()) {
      if (job.expired || job.consuming || !job.captures.has(update.view)) continue;
      if (update.docChanged || !update.startState.selection.eq(update.state.selection, true)
        || !sameFolds(readFolds(update.startState), readFolds(update.state))) this.expire(job);
    }
    const move = update.transactions.map(tr => tr.annotation(preparedMove)).find(proof => proof !== undefined);
    if (!move || update.transactions.length !== 1) {
      if (update.docChanged || !update.startState.selection.eq(update.state.selection, true)
        || !sameFolds(readFolds(update.startState), readFolds(update.state))) this.staged.delete(update.view);
      return false;
    }
    if (!this.host.committing.has(update.view) || move.target.doc !== update.startState.doc || !update.state.doc.eq(move.expected)) return false;
    this.editors.get(update.view)?.cache.cancel(); this.staged.set(update.view, move);
    return true;
  }
  contextChanged(): void { for (const job of this.jobs.values()) if (!job.consuming) this.expire(job); }
  private expire(job: Job): void {
    if (job.expired || this.jobs.get(job.view) !== job) return;
    job.expired = true; job.preparation.cancel(); job.ui.expire(this.t('sectionExpired'));
  }
  private fail(job: Job, error: unknown): void {
    if (this.jobs.get(job.view) !== job || job.expired) return;
    job.expired = true; job.preparation.cancel();
    job.ui.expire(this.t(error instanceof BlockError ? error.reason : 'failed'));
  }
  private restoreFocus(job: Job): void {
    if (this.alive && !Platform.isMobile && !job.expired && job.view.dom.isConnected && fileFor(job.view) === job.target.file) job.view.focus();
  }
  private finish(job: Job | undefined): void {
    if (!job || this.jobs.get(job.view) !== job) return;
    this.jobs.delete(job.view); job.preparation.cancel(); job.cleanup(); job.ui.close();
  }
  destroy(): void {
    this.alive = false;
    for (const job of this.jobs.values()) this.finish(job);
    this.peers.destroy(); this.editors.clear(); this.staged.clear();
  }
}
