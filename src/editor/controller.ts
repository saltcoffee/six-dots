import { EditorView, ViewPlugin } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { Platform, setIcon } from 'obsidian';
import type { Menu } from 'obsidian';
import { atPosition, siblingBlocks } from '../domain/block';
import type { Block, Plan } from '../domain/block';
import { move } from '../domain/move';
import { Actions } from '../obsidian/actions';
import { editable, targetFor, fileFor } from './context';
import type { Target } from './context';
import { SnapshotCache } from './snapshot-cache';
import { fitPoint, intersect, viewportBounds } from './viewport';

interface Drag {
  target: Target; pointer: number; x: number; y: number; currentX: number; currentY: number;
  active: boolean; plan: Plan | null;
  touch: boolean; armed: boolean;
}
function usesTouchUI(view: EditorView): boolean {
  return Platform.isMobile || !!view.dom.ownerDocument.defaultView?.matchMedia?.('(pointer: coarse)').matches;
}
export class Controller {
  readonly cache = new SnapshotCache();
  private button: HTMLButtonElement;
  private indicator: HTMLDivElement;
  private preview: HTMLDivElement;
  private status: HTMLDivElement;
  private block: Block | null = null;
  private menu: Menu | null = null;
  private drag: Drag | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private disposed = false;
  private cleanup: (() => void)[] = [];
  private point: { x: number; y: number } | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private get touchUI(): boolean { return usesTouchUI(this.view); }
  private get cursorHandle(): boolean { return this.touchUI || this.actions.settings().handle === 'cursor'; }
  constructor(readonly view: EditorView, readonly actions: Actions, private remove: () => void) {
    const doc = view.dom.ownerDocument;
    this.button = doc.createElement('button'); this.button.className = 'six-dots-handle'; this.button.type = 'button';
    this.button.setAttribute('aria-label', actions.t('actions')); this.button.title = actions.t('actions');
    this.button.setAttribute('aria-haspopup', 'menu'); setIcon(this.button, 'grip-vertical');
    this.indicator = doc.createElement('div'); this.indicator.className = 'six-dots-drop';
    this.preview = doc.createElement('div'); this.preview.className = 'six-dots-preview';
    this.status = doc.createElement('div'); this.status.className = 'six-dots-status'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    for (const element of [this.button, this.indicator, this.preview]) element.hidden = true;
    doc.body.append(this.button, this.indicator, this.preview, this.status);
    this.listen(view.dom, 'pointermove', event => this.hover(event as PointerEvent));
    this.listen(view.dom, 'pointerleave', () => this.hideLater());
    this.listen(view.scrollDOM, 'scroll', () => { this.measure(); if (this.drag?.active) this.findDrop(); });
    this.listen(this.button, 'pointerenter', () => this.clearHide());
    this.listen(this.button, 'pointerleave', () => this.hideLater());
    this.listen(this.button, 'pointerdown', event => this.down(event as PointerEvent));
    // Obsidian also recognizes TouchEvents for navigation. Only our handle owns these touches.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) this.listen(this.button, type, event => { event.preventDefault(); event.stopPropagation(); });
    this.listen(this.button, 'contextmenu', event => event.preventDefault());
    this.listen(this.button, 'click', event => { if ((event as MouseEvent).detail === 0) { event.preventDefault(); this.openMenu(); } });
    // Observe only our owned gesture at document capture: embedded/native surfaces may retarget events.
    this.listen(doc, 'pointermove', event => this.dragMove(event as PointerEvent), true);
    this.listen(doc, 'pointerup', event => this.up(event as PointerEvent), true);
    this.listen(doc, 'pointercancel', () => this.cancel(), true);
    this.listen(doc, 'pointerdown', event => { if (this.drag && (event as PointerEvent).pointerId !== this.drag.pointer) this.cancel(); }, true);
    this.listen(this.button, 'lostpointercapture', () => { if (this.drag) this.cancel(); });
    this.listen(this.button, 'keydown', event => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') { event.preventDefault(); this.openMenu(); }
    });
    this.listen(view.dom, 'compositionstart', () => { this.cancel(); this.block = null; this.button.hidden = true; });
    this.listen(doc, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape' && this.drag) { event.preventDefault(); this.cancel(); } });
    this.listen(view.dom, 'focusin', () => this.refresh());
    this.listen(view.dom, 'focusout', () => this.measure());
    if (doc.defaultView) {
      this.listen(doc.defaultView, 'blur', () => this.cancel()); this.listen(doc.defaultView, 'resize', () => this.measure());
      if (doc.defaultView.visualViewport) {
        this.listen(doc.defaultView.visualViewport, 'resize', () => { this.cancel(); this.measure(); });
        this.listen(doc.defaultView.visualViewport, 'scroll', () => this.measure());
      }
    }
    this.prepare();
  }
  private listen(target: EventTarget, type: string, callback: EventListener, capture = false): void {
    const options = type.startsWith('touch') ? { capture, passive: false } : capture;
    target.addEventListener(type, callback, options);
    this.cleanup.push(() => target.removeEventListener(type, callback, options));
  }
  private prepare(): void {
    this.block = null; this.button.hidden = true;
    this.cache.prepare(this.view.state.doc.toString(), () => this.refresh());
  }
  update(update: ViewUpdate): void {
    if (update.docChanged) {
      if ((this.menu || this.drag) && !this.actions.committing.has(this.view)) this.actions.notify(this.actions.t('changed'));
      this.menu?.hide(); this.cancel(); this.prepare();
    }
    else if (update.selectionSet) this.refresh();
    if (update.viewportChanged || update.geometryChanged) this.measure();
  }
  refresh(): void {
    if (this.disposed || this.drag || this.menu) return;
    if (!editable(this.view)) { this.block = null; this.button.hidden = true; return; }
    this.measure();
  }
  private hover(event: PointerEvent): void {
    if (this.drag || this.menu || this.cursorHandle || event.pointerType === 'touch') return;
    this.clearHide(); this.point = { x: event.clientX, y: event.clientY };
    this.refresh();
  }
  private clearHide(): void { if (this.hideTimer !== null) clearTimeout(this.hideTimer); this.hideTimer = null; }
  private hideLater(): void {
    this.clearHide();
    if (this.cursorHandle) return;
    this.hideTimer = setTimeout(() => { if (!this.drag && !this.menu) { this.button.hidden = true; this.point = null; this.block = null; } }, 150);
  }
  private measure(): void {
    if (this.disposed) return;
    this.view.requestMeasure({
      key: this,
      read: view => {
        if (this.disposed) return null;
        if (!editable(view)) { this.block = null; return null; }
        if (this.touchUI && !view.hasFocus && !this.menu && !this.drag && view.dom.ownerDocument.activeElement !== this.button) return null;
        // Selection updates run before DOM writes finish; resolve hover coordinates in the read phase.
        if (!this.drag && !this.menu) {
          const snapshot = this.cache.snapshot;
          const pos = this.cursorHandle ? view.state.selection.main.head
            : this.point && snapshot ? view.posAtCoords(this.point) : null;
          this.block = pos === null || !snapshot ? null : atPosition(snapshot, pos);
        }
        const block = this.block;
        if (!block) return null;
        const visible = view.visibleRanges.find(range => range.to >= block.from && range.from <= block.contentTo);
        if (!visible) return null;
        const coords = view.coordsAtPos(Math.max(block.from, visible.from));
        const bounds = this.visibleBounds(), x = view.scrollDOM.getBoundingClientRect().left + 2;
        const width = this.touchUI ? 44 : 24;
        return bounds && coords && x >= bounds.left && x + width <= bounds.right && coords.bottom > bounds.top && coords.top < bounds.bottom
          ? fitPoint(bounds, x, coords.top - (this.touchUI ? 10 : 2), width, this.touchUI ? 44 : 26) : null;
      },
      write: position => {
        if (this.disposed) return;
        const touch = this.touchUI;
        this.button.classList.toggle('is-touch', touch);
        this.button.setAttribute('aria-label', this.actions.t(touch ? 'touchActions' : 'actions'));
        this.button.hidden = !position;
        if (position) { this.button.style.left = `${position.x}px`; this.button.style.top = `${position.y}px`; }
      },
    });
  }
  private visibleBounds() {
    const bounds = this.view.scrollDOM.getBoundingClientRect(), win = this.view.dom.ownerDocument.defaultView;
    return win ? intersect(bounds, viewportBounds(win)) : bounds;
  }
  current(): Target | null {
    if (!editable(this.view)) { this.actions.notify(this.actions.t('selectOne')); return null; }
    const snapshot = this.cache.snapshot;
    if (!snapshot) { this.actions.notify(this.actions.t('preparing')); return null; }
    const block = atPosition(snapshot, this.view.state.selection.main.head);
    if (!block) { this.actions.notify(this.actions.t('unsupported')); return null; }
    return targetFor(this.view, block, snapshot);
  }
  peek(): Target | null {
    if (!editable(this.view) || !this.cache.snapshot) return null;
    const block = atPosition(this.cache.snapshot, this.view.state.selection.main.head);
    return block ? targetFor(this.view, block, this.cache.snapshot) : null;
  }
  openMenu(atCursor = false): void {
    const target = atCursor ? this.current() : this.block && this.cache.snapshot ? targetFor(this.view, this.block, this.cache.snapshot) : null;
    if (!target) return;
    this.block = target.block;
    const cursor = this.view.coordsAtPos(this.view.state.selection.main.head);
    const rect = this.button.hidden ? cursor ?? this.view.dom.getBoundingClientRect() : this.button.getBoundingClientRect();
    this.menu?.hide();
    this.button.setAttribute('aria-expanded', 'true');
    if (Platform.isMobile) this.view.contentDOM.blur();
    this.menu = this.actions.showMenu(this.view, target, { x: rect.left, y: rect.bottom }, () => {
      this.menu = null; this.button.setAttribute('aria-expanded', 'false'); this.hideLater();
    });
  }
  private down(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || !this.block || !this.cache.snapshot) return;
    const target = targetFor(this.view, this.block, this.cache.snapshot);
    if (!target) return;
    event.preventDefault(); event.stopPropagation(); this.clearHide();
    const touch = event.pointerType === 'touch';
    const drag: Drag = { target, pointer: event.pointerId, x: event.clientX, y: event.clientY, currentX: event.clientX, currentY: event.clientY, active: false, plan: null, touch, armed: !touch };
    this.drag = drag;
    if (touch && this.actions.settings().drag) this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.drag !== drag) return;
      drag.armed = true; this.button.classList.add('is-ready'); this.status.textContent = this.actions.t('dragReady');
    }, 350);
    try { this.button.setPointerCapture(event.pointerId); } catch { this.cancel(); }
  }
  private dragMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopPropagation();
    drag.currentX = event.clientX; drag.currentY = event.clientY;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > (drag.touch ? 8 : 5);
    if (!drag.active && moved && (!drag.armed || !this.actions.settings().drag)) { this.cancel(); return; }
    if (!drag.active && moved) {
      if (this.actions.folded(this.view, drag.target.block)) { this.actions.notify(this.actions.t('foldHeading')); this.cancel(); return; }
      drag.active = true; this.button.classList.add('is-dragging');
      const suffix = drag.target.block.hasChildren ? this.actions.t('includesChildren') : drag.target.block.kind === 'heading' ? this.actions.t('onlyHeading') : '';
      this.preview.textContent = [this.actions.t(drag.target.block.kind), suffix, drag.target.block.text.slice(0, 90)].filter(Boolean).join(' · ');
      this.preview.hidden = false;
    }
    if (drag.active) { event.preventDefault(); this.animate(); }
  }
  private animate(): void {
    if (this.frame || !this.drag?.active) return;
    const win = this.view.dom.ownerDocument.defaultView;
    if (!win) return;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0;
      const drag = this.drag;
      if (!drag?.active) return;
      const bounds = this.visibleBounds();
      if (!bounds) { this.cancel(); return; }
      const edge = 40, y = drag.currentY;
      const delta = y < bounds.top + edge ? -Math.min(18, (bounds.top + edge - y) / 2) : y > bounds.bottom - edge ? Math.min(18, (y - bounds.bottom + edge) / 2) : 0;
      if (drag.currentX >= bounds.left && drag.currentX <= bounds.right) this.view.scrollDOM.scrollTop += delta;
      const point = fitPoint(viewportBounds(win), drag.currentX + 16, drag.currentY + 12, 280, 60);
      this.preview.style.left = `${point.x}px`; this.preview.style.top = `${point.y}px`;
      this.findDrop();
      if (delta !== 0) this.animate();
    });
  }
  private findDrop(): void {
    const drag = this.drag;
    if (!drag?.active) return;
    drag.plan = null; this.indicator.hidden = true;
    const bounds = this.visibleBounds();
    if (!bounds || drag.currentX < bounds.left || drag.currentX > bounds.right || drag.currentY < bounds.top || drag.currentY > bounds.bottom) return;
    const track = this.touchUI ? 48 : 28;
    const pos = this.view.posAtCoords({ x: Math.min(bounds.right - 2, Math.max(bounds.left + track + 4, drag.currentX)), y: drag.currentY });
    if (pos === null || pos >= drag.target.block.from && pos <= drag.target.block.to) return;
    const siblings = siblingBlocks(drag.target.snapshot, drag.target.block);
    const candidate = siblings.find(block => block.from <= pos && pos <= block.to)
      ?? [...siblings].sort((a, b) => Math.min(Math.abs(a.from - pos), Math.abs(a.to - pos)) - Math.min(Math.abs(b.from - pos), Math.abs(b.to - pos)))[0];
    if (!candidate) return;
    const start = this.view.coordsAtPos(candidate.from), end = this.view.coordsAtPos(candidate.to);
    const after = start && end ? drag.currentY > (start.top + end.bottom) / 2 : pos > (candidate.from + candidate.to) / 2;
    const coords = after ? end : start;
    try { drag.plan = move(drag.target.snapshot, drag.target.block, candidate, after); } catch { return; }
    if (!drag.plan || !coords) return;
    this.indicator.hidden = false; this.indicator.style.left = `${bounds.left + track}px`;
    this.indicator.style.top = `${after ? coords.bottom : coords.top}px`;
    this.indicator.style.width = `${Math.max(0, bounds.right - bounds.left - track - 8)}px`;
    this.status.textContent = this.actions.t('drop');
  }
  private up(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopPropagation();
    drag.currentX = event.clientX; drag.currentY = event.clientY;
    if (drag.active) this.findDrop();
    const wasActive = drag.active;
    const bounds = this.view.scrollDOM.getBoundingClientRect();
    this.point = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom ? { x: event.clientX, y: event.clientY } : null;
    this.drag = null; this.resetDrag(drag.pointer);
    if (wasActive && drag.plan) this.actions.apply(this.view, drag.target, drag.plan);
    else if (!wasActive && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= (drag.touch ? 8 : 5)) this.openMenu();
    this.refresh();
  }
  private resetDrag(pointer: number): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null; this.button.classList.remove('is-ready');
    this.status.textContent = '';
    if (this.button.hasPointerCapture(pointer)) this.button.releasePointerCapture(pointer);
    if (this.frame) this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = 0; this.button.classList.remove('is-dragging'); this.preview.hidden = true; this.indicator.hidden = true;
  }
  private cancel(): void {
    const drag = this.drag; this.drag = null;
    if (drag) {
      this.resetDrag(drag.pointer);
      if (!this.cursorHandle) { this.point = null; this.block = null; this.button.hidden = true; }
    }
  }
  destroy(): void {
    this.disposed = true; this.cache.cancel(); this.menu?.hide(); this.clearHide(); this.cancel();
    this.cleanup.forEach(cleanup => cleanup()); this.cleanup = [];
    for (const element of [this.button, this.indicator, this.preview, this.status]) element.remove();
    this.remove();
  }
}

export function editorExtension(actions: Actions, controllers: Map<EditorView, Controller>) {
  return [EditorView.editorAttributes.of(view => fileFor(view) ? { class: `six-dots-editor${usesTouchUI(view) ? ' six-dots-touch-editor' : ''}` } : null), ViewPlugin.define(view => {
    let controller: Controller | null = null;
    const sync = () => {
      if (fileFor(view) && !controller) { controller = new Controller(view, actions, () => controllers.delete(view)); controllers.set(view, controller); }
      else if (!fileFor(view) && controller) { controller.destroy(); controller = null; }
    };
    sync();
    return { update(update: ViewUpdate) { sync(); controller?.update(update); }, destroy() { controller?.destroy(); } };
  })];
}
