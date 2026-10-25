# Changelog

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
