# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/),
versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

First public release. Tested with Hermes Agent 0.22.

### Added
- Chat over the native Hermes gateway protocol: live work steps, permission and clarification cards,
  steer/stop, retry, edit, branch, slash commands and skills, goal bar, per-chat modes.
- Scheduled tasks: list, editor, per-task chats with a schedule bar, in-chat settings sheet, pause and mute.
- Obsidian knowledge base: notes, wiki-links, backlinks, search, graph, live updates, note chips in answers.
- Files both ways, large files by temporary link, audio player, link previews, YouTube embeds.
- Read-only share links, export to Markdown, chat lists.
- Plugins page: the Hermes MCP catalog with brand icons, search, one-tap connect, OAuth sign-in that finishes
  on a phone, enable/disable, status and tool lists for catalog and custom servers.
- Extensions tab (Hermes code plugins: catalog, `~/.hermes/plugins` folder, settings, updates with capability
  consent) and skills tab (installed, official catalog, search across sources, install, enable/disable).
- "Translate" next to English descriptions, done by Hermes' auxiliary model and cached.
- PWA with web push, passkeys, session management.
- `npm run setup` (first run), `npm run doctor` (Hermes version and time zone checks), Hermes `webchat` plugin,
  iCloud vault mirror for macOS.
- Versioned database migrations; tests and CI.

### Security
- Server survives malformed URLs, a missing Hermes Python and unreadable files instead of crashing.
- Images from other sites in answers load only on click (prompt-injection exfiltration).
- Proxy headers trusted only from localhost; bounded rate-limit state.
