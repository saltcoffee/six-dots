import { EditorState } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownView, editorInfoField } from 'obsidian';
import type { TFile } from 'obsidian';
import type { Block, Snapshot } from '../domain/block';

/** Immutable editor context shared by block, section, and range moves. */
export interface MoveContext {
  readonly snapshot: Snapshot;
  readonly doc: Text;
  readonly file: TFile;
  readonly path: string;
}
export interface Target extends MoveContext {
  readonly block: Block;
}
export function inTable(node: Node | null): boolean {
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  return !!element?.closest('table, .cm-table-widget');
}
export function tableFocused(view: EditorView): boolean {
  const active = view.dom.ownerDocument.activeElement;
  return !!active && view.dom.contains(active) && inTable(active);
}
export function fileFor(view: EditorView): TFile | null {
  // Live Preview cells inherit editor extensions, but their documents contain only cell text.
  if (inTable(view.dom)) return null;
  const info = view.state.field(editorInfoField, false);
  return info instanceof MarkdownView && info.getMode() === 'source' ? info.file : null;
}
function baseEditable(view: EditorView): boolean {
  return !!fileFor(view) && !view.state.facet(EditorState.readOnly) && view.state.facet(EditorView.editable)
    && !view.composing && view.state.selection.ranges.length === 1;
}
export function editable(view: EditorView): boolean {
  return baseEditable(view) && view.state.selection.main.empty;
}
/** One continuous non-empty range; used only by the explicit multi-block actions. */
export function rangeEditable(view: EditorView): boolean {
  return baseEditable(view) && !view.state.selection.main.empty;
}
export function targetFor(view: EditorView, block: Block, snapshot: Snapshot): Target | null {
  const file = fileFor(view);
  return file && editable(view) ? { block, snapshot, doc: view.state.doc, file, path: file.path } : null;
}
export function contextFor(view: EditorView, snapshot: Snapshot): MoveContext | null {
  const file = fileFor(view);
  return file ? { snapshot, doc: view.state.doc, file, path: file.path } : null;
}
/** Legacy single-block/section target: requires the original empty caret selection. */
export function targetValid(view: EditorView, target: MoveContext): boolean {
  return view.dom.isConnected && editable(view) && fileFor(view) === target.file && target.file.path === target.path
    && view.state.doc === target.doc;
}
/** Multi-block target: requires one continuous range (empty or not) and writable editor identity. */
export function contextValid(view: EditorView, target: MoveContext): boolean {
  return view.dom.isConnected && baseEditable(view) && fileFor(view) === target.file && target.file.path === target.path
    && view.state.doc === target.doc;
}
