# Contributing to SixDots

Use Node.js 24 and npm. Install with `npm ci`, then run `npm run dev` while developing. `npm run check` runs type checking, lint, tests, production build, and release validation.

The Obsidian SDK is pinned to the minimum supported app version, 1.8.7, so type checking catches accidental use of newer APIs. Keep CodeMirror external to share the host's runtime; bundle the independent Markdown parser and its Lezer dependencies. A newer development tool does not by itself require raising `minAppVersion`.

Test in a separate vault by copying `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/six-dots/`. Verify undo, cancellation, nested lists, and both editing modes. Never use private notes as test fixtures.

For mobile changes, verify tap actions, hold-then-drag, early movement, multiple touches, keyboard resizing, and narrow dialogs. Record whether testing used mobile emulation or a physical iOS/Android device.

`npm run fixtures` generates deterministic artificial benchmark notes and their checksums under the ignored `docs/0.1.4/fixtures/` directory. The mixed note has 10,000 lines; deep lists cover three depths. Giant single-block notes measure preparation and location, while separate variants add a sibling for legal move measurements. Do not count a no-op as a completed move. Keep UI measurements separate from parser microbenchmarks, and record the host version, visibility, mode, sample checksum, repetitions, and raw timings.

Before publishing, verify the four existing action families, cancellation, undo, and unloading in real macOS instances of Obsidian 1.8.7 and the stable host used for the release. Changes affecting iOS or Android require physical-device verification on each affected platform; emulation does not replace it. Keep unfinished release entries marked Unreleased until those gates pass.

Keep source files under 600 lines. Put text transformations in `src/domain`, editor state and geometry in `src/editor`, and host operations in `src/obsidian`. Keep user text in both translation dictionaries: Chinese locales use Chinese; all others use English.

Open a focused pull request against `main`. Explain what changes for users and how you tested it. The required `quality` check must pass. Do not commit generated `main.js`, `dist`, or local `docs`.

For a release, update `package.json`, `manifest.json`, `versions.json`, and `CHANGELOG.md` together. After the change is merged, create a tag exactly matching the version, such as `0.1.0` (no `v`). A pushed tag runs validation, builds the plugin and zip, and publishes a GitHub Release. The release body contains the matching changelog section directly. No tag is created by the build scripts.

The main ruleset requires `quality` even when creating the branch. When bootstrapping an empty repository, push a development branch and have CI pass before creating main at that checked commit. Subsequent main updates require a pull request. There are no bypass actors.

MIT covers the source code. Donation QR images and payment-service marks identify the maintainer and their respective services; do not replace them in a contribution.
