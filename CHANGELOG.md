# Changelog

## 0.1.8 - 2026-11-20

- Speed up multi-block and whole-section move preview construction by reading line numbers from the captured CodeMirror `Text` (`doc.lineAt`) instead of rescanning or splitting full document strings.
- Optimize drag drop-target resolution with a single-pass nearest-sibling scan (preserving original tie order) and gesture-scoped sibling reuse, and remove redundant document serializations during multi-block capability checks.
- Migrate all 13 DOM creation sites to Obsidian helpers (`createEl`, `createDiv`, `createSpan`, and adopted `createFragment`) while keeping popout-window document ownership and initial hidden overlay states.
- Scope all hide, touch-hold, cooperative parsing/validation, and peer-sync timers to their owning editor window, and release pending peer waits and receipts immediately when a view detaches.
- Remove redundant type assertions in section-fold lookup, extraction target verification, and active move validation, and bind captured `MarkdownView` methods cleanly during CRLF save wrapping.
- Add dual-version declarative settings (`getSettingDefinitions()`) for Obsidian 1.13.0+ search indexing alongside the legacy `display()` path for Obsidian 1.8.7+, preserving refresh, save queueing, future-schema write protection, and mobile handle behavior.
- Remove CSS `clip-path` and `!important` from `.six-dots-status` and hidden overlay rules while keeping screen-reader live regions and specificity-scoped hiding.

Automated typecheck, lint, unit/regression tests, production build, release metadata checks, and isolated desktop host verification in Obsidian 1.15.1 passed (declarative settings search and persistence, popout DOM/timer cleanup, theme-override CSS hiding, CRLF saves, and 5000-paragraph preview checks). Obsidian 1.8.7, assistive-technology, community-scanner re-scan, paired 0.1.7 A/B performance recording, and physical iOS/Android device verification remain pending.

## 0.1.7 - 2026-11-17

- Move several consecutive top-level blocks, or several complete list siblings, up or down as one checked group from a plain non-empty selection.
- Preview the complete range, content added beyond the original selection, unit and descendant counts, folded content, the adjacent target, numbering impact, and the resulting order before confirming.
- Apply the group exchange in a single isolated editor transaction, keep numbering, block IDs, separators, and folds consistent, and restore the complete source selection with its original direction after one undo.
- Add **Move selected blocks up/down** commands and host editor-menu entries in English and Chinese without changing the existing single-block or section commands.
- Cover the new selection rules, exchange planning, transaction proof, preview lifecycle, and bilingual key parity with automated tests; legacy block and section behaviour is unchanged.
- Keep the source summary visible when a range preview opens, keep its controls accessible, and summarize long order lists with an explicit omitted count.
- Preserve CRLF when SixDots edits are saved, undone, redone, synchronized across views, or saved while the file closes, using the host serialization boundary.

Core desktop flows were validated in the locally installed Obsidian 1.15.1. Mobile-device, assistive-technology, and real-user comparison checks remain pending.

## 0.1.6 - 2026-11-10

- Exchange adjacent sections at the same heading level within one parent, including their body and subheadings. Preview both ranges and the new order before confirming.
- Preserve section and internal folds by content, including undo/redo and same-file editor synchronization. Refuse ambiguous headings, block IDs, boundaries, and hidden cursors.
- Prepare move candidates cooperatively with visible cancellation and reuse the verified snapshot after a checked, isolated transaction. Existing block commands and heading-line moves keep their scope.
- Fix inline-comment heading detection, preserve peer selected content and fold synchronization through unrelated state updates, and slice indexed section validation so it remains cancelable.

## 0.1.5 - 2026-11-03

- Convert simple quotes to plain text from the block menu, preserving paragraph breaks, supported inline Markdown, and undo history.
- Protect literal table delimiters when removing quote markers and refuse conversions that cannot preserve Markdown structure or block IDs.
- Provide English and Chinese conversion feedback. Keep full quote validation off the editor's snapshot preparation path.

Release validation is still in progress. Minimum-host, IME, assistive technology, performance, and affected mobile-device checks remain open.

## 0.1.4 - 2026-10-30

- Invalidate open block actions and pending drags when a note is switched or renamed, including when its text does not change.
- Prevent destroyed editor controllers and unloaded plugin instances from reopening actions or continuing stale work.
- Keep keyboard and assistive activation events from immediately dismissing the block menu they just opened.
- Use Obsidian's menu renderer so keyboard dismissal and focus handling stay in the originating window.
- Refresh touch-handle visibility when focus leaves the handle itself, while keeping a focused handle usable.
- Reject drops outside the source list or without a visible insertion boundary instead of reusing a hidden or redirected move plan.
- Fix paragraph-to-task and paragraph-to-bullet conversions being rejected when a single-item list shares its range with its container.
- Preserve editable extraction inputs for invalid names, folders, and conflicts; stop closed operations before file creation.
- Keep the target path available when note creation has an uncertain result, and report missing targets when opening recovery links.
- Add lifecycle, extraction fault, undo-isolation, and snapshot-cancellation coverage, plus reproducible artificial performance fixtures.

Known verification limits: the latest desktop UI regression did not confirm Escape focus restoration; the final adjustment still needs a passing real-host result. Native IME, complete performance profiling, and affected iOS/Android physical-device checks remain incomplete.

## 0.1.3 - 2026-10-25

- Normalize iOS visual-viewport coordinates for handles, drop indicators, and drag previews when the keyboard shifts the viewport.
- Refresh handle visibility after closing block actions so unfocused mobile editors do not keep a stale handle.

## 0.1.2 - 2026-10-25

- Enable SixDots on phones and tablets with a cursor-following handle and a larger touch target.
- Lower the minimum Obsidian version to 1.8.7 and compile against that SDK; bundle the private Markdown parser's runtime so older apps do not need newer Lezer libraries.
- Add tap-to-open block actions and hold-then-drag reordering; cancel early movement, additional touches, viewport changes, and interrupted gestures.
- Keep handles, drop targets, and drag previews inside the visible editor area when the on-screen keyboard changes the viewport.
- Adapt settings and extraction dialogs to narrow screens and keep a selectable link available when clipboard access fails.
- Preserve desktop mouse interactions and add mobile gesture, cancellation, and viewport regression coverage.

Mobile support is an early preview. Validated with automated touch-event tests and Obsidian mobile emulation; iOS and Android physical-device verification is pending.

## 0.1.1 - 2026-10-25

- Fix six-dot handles disappearing when clicking in a note to enter editing.
- Refresh the hovered block after scrolling so the handle and its actions stay aligned with the visible content.

## 0.1.0 - 2026-10-25

- Add six-dot handles for moving paragraphs, headings, list-item subtrees, quotes, callouts, and fenced code blocks.
- Add quick formatting, native block links, and extraction to new notes with conflict checks.
- Preserve list nesting and ordered-list starting numbers; keep moves and conversions in independent undo steps.
- Add keyboard commands and settings for handle visibility, dragging, callout type, and extraction folder.
- Display Chinese text for Chinese Obsidian locales and English for every other locale.
- Add English and Chinese user guides, optional WeChat / Alipay support, and automatic tag releases.
- Preserve existing inline quote IDs and create multiline-list IDs at the actual paragraph boundary, with binding validation before commit.
- Protect code-first list items from formatting and ID insertion, and prevent partial actions on compact nested lists.

Initial desktop preview. Not yet listed in the Obsidian community directory. Tables, math, frontmatter, and unsupported containers remain protected.
