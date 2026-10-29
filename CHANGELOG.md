# Changelog

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
