# Contributing to SixDots

Use Node.js 24 and npm. Install with `npm ci`, then run `npm run dev` while developing. `npm run check` runs type checking, lint, tests, production build, and release validation.

Test in a separate vault by copying `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/six-dots/`. Verify undo, cancellation, nested lists, and both editing modes. Never use private notes as test fixtures.

Keep source files under 600 lines. Put text transformations in `src/domain`, editor state and geometry in `src/editor`, and host operations in `src/obsidian`. Keep user text in both translation dictionaries: Chinese locales use Chinese; all others use English.

Open a focused pull request against `main`. Explain what changes for users and how you tested it. The required `quality` check must pass. Do not commit generated `main.js`, `dist`, or local `docs`.

For a release, update `package.json`, `manifest.json`, `versions.json`, and `CHANGELOG.md` together. After the change is merged, create a tag exactly matching the version, such as `0.1.0` (no `v`). A pushed tag runs validation, builds the plugin and zip, and publishes a GitHub Release. The release body contains the matching changelog section directly. No tag is created by the build scripts.

The main ruleset requires `quality` even when creating the branch. When bootstrapping an empty repository, push a development branch and have CI pass before creating main at that checked commit. Subsequent main updates require a pull request. There are no bypass actors.

MIT covers the source code. Donation QR images and payment-service marks identify the maintainer and their respective services; do not replace them in a contribution.
