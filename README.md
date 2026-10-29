# SixDots

[English](README.md) · [简体中文](README.zh-CN.md)

**Rearrange your notes with a six-dot handle.**

SixDots brings Notion-style block actions to Obsidian. Drag a paragraph into place, move a list item together with its children, or change formatting from a small menu beside your text.

## What you can do

- **Drag blocks to reorder them.** Move paragraphs, individual headings, quotes, callouts, and fenced code blocks within a note.
- **Keep lists together.** Reorder sibling items without leaving their nested content behind. Ordered lists keep their starting number.
- **Change formatting in place.** Turn supported text into headings, bullet points, tasks, quotes, or callouts.
- **Copy a block link.** Reuse a native block ID or explicitly create one for the selected block.
- **Extract to a new note.** Move an eligible paragraph or list-item subtree into a new note and leave a link behind.
- **Work from the keyboard.** Open block actions or use commands for common actions. Choose your own shortcuts.

## Getting started

1. Open a Markdown note in **Live Preview** or **Source mode**.
2. On desktop, hover beside a supported block. On phones and tablets, tap the text to place the cursor; the handle follows the cursor.
3. **Click or tap** the handle for block actions. To reorder, drag with a mouse, or hold the handle for about **350 ms**, then drag with a finger.

A wrapped paragraph is one block. A parent list item includes its children. The insertion line shows an allowed destination; press **Esc** to cancel. Moves and formatting changes can be undone normally.

Switching or renaming a note invalidates its open actions and pending drag. Start again in the current note. If extraction cannot confirm whether a note was created, its feedback keeps the target path available; inspect the source and destination before starting another extraction.

For keyboard access, open the command palette and search for **SixDots: Open block actions**. Other commands move blocks up or down, convert to a task or callout, copy a block link, and extract to a new note. No shortcuts are assigned by default.

## Installation

SixDots is **not yet listed in the Obsidian community directory**. Install it manually from GitHub Releases.

To install a published release manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/saltcoffee/six-dots/releases), or extract the `six-dots` folder from the release zip.
2. Put those files in `<your vault>/.obsidian/plugins/six-dots/`.
3. Restart Obsidian and enable **SixDots** under **Settings → Community plugins**.

Obsidian **1.8.7 or later** is required. SixDots supports desktop, phones, and tablets in editing views. The plugin is compiled against the 1.8.7 API; key actions, undo, and unloading have been tested on macOS with Obsidian 1.8.7 and 1.14.5. Mobile support is an early preview: automated touch-event tests and Obsidian mobile emulation have been checked; iOS and Android physical-device verification is pending. Desktop has been manually tested on macOS; Windows and Linux verification is pending. Reading view is outside the current scope.

On mobile, scroll and select text in the note normally. Start a drag from the handle after holding it; moving too early cancels the gesture. You can also choose **Move block up/down** from its menu without dragging. Mobile always uses the cursor handle, including when settings are synced from a desktop. If automatic clipboard access fails, a dialog keeps the block link available to select and copy manually.

Version 0.1.4 verification limits: the latest desktop UI regression did not confirm focus restoration after closing the menu with Esc; the final adjustment still needs a passing real-host result. Native IME and complete performance profiling also remain unverified.

## Settings

| Setting | Default | What it changes |
| --- | --- | --- |
| Enable drag and drop | On | Turn dragging off while keeping menus and commands. |
| Show handle | On hover on desktop; at cursor on mobile | Desktop can switch modes. Mobile always follows the cursor. |
| Default callout type | Note | Choose Note, Info, Tip, or Warning. |
| Extraction folder | Same as source | Use an existing vault folder, or `/` for the vault root. |

The interface uses Chinese when Obsidian is set to a Chinese locale. Every other language uses English.

## Things to know

- List dragging stays within the same sibling group. It does not change nesting or move content between notes.
- Heading moves affect the heading line only. Expand a folded heading before moving it.
- Formatting options depend on the block. Headings require a single source line; list items starting with text can switch between ordinary bullets and standard tasks. Items starting with code, quotes, or headings do not offer formatting or new block IDs.
- Compact nested lists sharing one source line, such as `- - child`, are protected from local block actions.
- Tables, math, frontmatter, comments, and unsupported structures are protected. Their contents cannot be partially dragged out.
- On desktop and mobile, SixDots hides its handle and does not offer ordinary block actions inside tables, including tables nested in quotes, callouts, and lists in Source mode. Use Obsidian's native controls for table rows and columns. From parent text outside the table, you can still act on the complete parent block, including its table.
- Hovering, menus, and previews do not modify your note. Formatting writes the corresponding native Markdown.
- **Creating a block link adds a native `^block-id`.** Copied links use a full vault-path Wikilink, even if your usual preference is Markdown links. They are intended for this vault. Undoing a newly created ID invalidates that link.
- Blocks containing IDs cannot be converted or extracted in this version. Extraction also excludes subtrees with headings or dependencies that cannot be safely moved.
- **Undoing extraction restores the source text and keeps the new note.** If extraction stops partway, inspect both notes before retrying; SixDots does not automatically delete either file.
- Callouts, Wikilinks, and block references use Obsidian syntax and may not work in other Markdown applications.

## Privacy

SixDots works locally. It requires no account, makes no network requests, collects no telemetry, and does not access files outside your vault. Settings are stored with the plugin. Clipboard writes occur only when you choose a copy action.

## Support development

SixDots is free to use. If you find it useful, you are welcome to voluntarily tip to support development.

<table>
  <tr>
    <th><img src="assets/wechat.svg" width="22" height="22" alt="WeChat Pay icon"> WeChat Pay</th>
    <th><img src="assets/alipay.svg" width="22" height="22" alt="Alipay icon"> Alipay</th>
  </tr>
  <tr>
    <td><a href="assets/wechat-donate.jpg"><img src="assets/wechat-donate.jpg" width="220" alt="WeChat Pay donation QR code"></a></td>
    <td><a href="assets/alipay-donate.jpg"><img src="assets/alipay-donate.jpg" width="220" alt="Alipay donation QR code"></a></td>
  </tr>
</table>

## Feedback and contributions

[Report a bug or suggest a feature](https://github.com/saltcoffee/six-dots/issues). Include your Obsidian and SixDots versions and a small example without private information. Developers can find setup instructions in [Contributing](CONTRIBUTING.md).

Source code is available under the [MIT License](LICENSE). SixDots is an independent project. Payment-service marks belong to their owners; see [third-party notices](THIRD_PARTY_NOTICES.md).
