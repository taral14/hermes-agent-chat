# Hermes Chat

**A private, ChatGPT-style web chat built specifically for [Hermes Agent](https://hermes-agent.nousresearch.com).**
It talks to Hermes over its native gateway protocol, so you see the agent work live — tools, sub-agents,
permission requests — and you can manage scheduled tasks, browse the Obsidian knowledge base Hermes writes to,
and get push notifications on your phone. One user, your own machine, no cloud.

[Українською](README.uk.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

![Chat with the agent's work steps expanded](docs/screenshots/chat.jpg)

> **Interface language:** the UI is currently in Ukrainian only. The code, docs and this README are in English
> and Ukrainian; translations of the interface are welcome (see [CONTRIBUTING](CONTRIBUTING.md)).

## Features

- **Live agent work.** Streaming answers plus every step Hermes takes: searches, file edits, terminal commands,
  sub-agents, with durations. When the answer is ready, the steps fold into «Worked 1 min · 5 steps».
- **Permission and clarification requests** arrive as cards with buttons. Per-chat mode: ask every time,
  allow everything, or plan only.
- **Steer, stop, retry, edit, branch.** Add to a running task, rewind and resend an earlier message,
  or fork the conversation from any answer.
- **Slash commands and skills** (`/goal`, `/plan`, `/loop`, your skills) with a goal bar for long-running goals.
- **Scheduled tasks.** Each task can write into its own chat; a bar under the title shows when it runs next,
  and a sheet lets you change the time, pause it or mute its notifications — or just ask Hermes in the chat.
- **Obsidian knowledge base.** Read the vault Hermes writes to: wiki-links, backlinks, search, a link graph,
  and notes mentioned in answers become clickable chips. Updates live.
- **Plugins.** Connect services from the Hermes MCP catalog (Notion, Linear, Figma, Todoist and ~60 more) like
  ChatGPT apps: one tap, sign in on the service's page (works from a phone too), turn servers on and off, see
  their status and tools. Your own MCP servers from `config.yaml` show up there as well.
- **Files both ways.** Attach images and documents; files Hermes sends (`MEDIA:/path`) arrive as players,
  previews and download cards. Huge files are never copied — you get a temporary download link.
- **Link previews, YouTube embeds, read-only share links**, export to Markdown, chat lists (like projects).
- **Installable PWA with web push** (iPhone included) for replies, permission requests and task results.
- **Passkeys** (Face ID, Touch ID, YubiKey), session list with remote sign-out, rate-limited password fallback.

| Permission request | Task settings in its chat | Knowledge base | Phone |
|---|---|---|---|
| ![](docs/screenshots/approval.jpg) | ![](docs/screenshots/task.jpg) | ![](docs/screenshots/knowledge-base.jpg) | ![](docs/screenshots/phone.jpg) |

## Requirements

- **macOS or Linux**, on the same machine as Hermes Agent.
- **Node.js 22.18+** (the server is TypeScript that Node runs directly — no build step for the server).
- **Hermes Agent 0.22+** with the gateway running (`hermes gateway start`) and its API server enabled
  (`API_SERVER_KEY` in `~/.hermes/.env`). The chat reads the key from there.
- For phone access: a domain with HTTPS in front of the chat (Cloudflare Tunnel, Caddy, nginx…).

The chat uses Hermes' gateway protocol, which is not a stable public API yet. Each release states the Hermes
version it was tested with, and `npm run doctor` warns when your Hermes is older.

## Install

```sh
git clone https://github.com/taral14/hermes-agent-chat.git && cd hermes-agent-chat
npm ci
npm run setup      # creates config.yaml with a random password (printed once) and .env from the example
npm run build
npm run doctor     # checks Node, Hermes, the gateway, the bridge and tells you how to fix anything missing
npm start          # http://localhost:5190
```

Sign in with the printed password, then open **Settings → Account → Sign-in and security**, add a passkey and
turn password sign-in off.

### Access from your phone

The server only listens on `127.0.0.1`. Put an HTTPS proxy in front of it and tell the chat its domain:

```sh
# .env
PUBLIC_HOST=chat.example.com
```

The easiest option is **Cloudflare Tunnel** (no open ports, no static IP):

```sh
cloudflared tunnel login
cloudflared tunnel create hermes-chat
cloudflared tunnel route dns hermes-chat chat.example.com
cloudflared tunnel run --url http://127.0.0.1:5190 hermes-chat
```

Or any reverse proxy, e.g. Caddy: `chat.example.com { reverse_proxy 127.0.0.1:5190 }`.
Passkeys are bound to the domain — after changing `PUBLIC_HOST`, add them again.
On iPhone, push notifications work only for the app added to the Home Screen (Share → Add to Home Screen).

### Run as a service

**macOS** — `~/Library/LaunchAgents/com.example.hermes-chat.plist` (adjust paths):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.hermes-chat</string>
  <key>ProgramArguments</key>
  <array><string>/opt/homebrew/bin/npm</string><string>start</string></array>
  <key>WorkingDirectory</key><string>/Users/you/hermes-agent-chat</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/hermes-chat.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/hermes-chat.log</string>
</dict>
</plist>
```

`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.hermes-chat.plist`

**Linux** — `~/.config/systemd/user/hermes-chat.service`:

```ini
[Service]
WorkingDirectory=%h/hermes-agent-chat
ExecStart=/usr/bin/npm start
Restart=always
[Install]
WantedBy=default.target
```

`systemctl --user enable --now hermes-chat` (and `loginctl enable-linger $USER` so it runs without a login).

### Let Hermes write to the chat (optional)

To receive scheduled-task results and `send_message` from Hermes, install the bundled Hermes plugin:

```sh
npm run setup:hermes        # the chat must have started at least once: it creates the hook key
hermes gateway restart      # when Hermes is idle
hermes send -t webchat:Test "hello"
```

See [`hermes-plugin/README.md`](hermes-plugin/README.md).

### Obsidian knowledge base (optional)

The chat shows the vault from `OBSIDIAN_VAULT_PATH` in Hermes' `.env` (or `VAULT_PATH` in the chat's `.env`).
On macOS a background service cannot read iCloud Drive; for a vault in iCloud run `npm run setup:vault-mirror`,
which keeps a copy in `data/vault/`.

### Time zone for scheduled tasks

Hermes evaluates schedules in the time zone from `timezone:` in `~/.hermes/config.yaml`. If it is empty,
tasks can shift by an hour after a daylight-saving change. Set it, e.g. `timezone: Europe/Kyiv`;
`npm run doctor` checks this.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_HOST` | `localhost` | The chat's domain: passkeys, share links, push, links Hermes sends |
| `PUBLIC_URL` | `https://PUBLIC_HOST` | Only if the public address differs |
| `PORT`, `BIND_HOST` | `5190`, `127.0.0.1` | Where the server listens |
| `HERMES_HOME` | `~/.hermes` | Hermes directory: `.env`, `config.yaml`, cache |
| `HERMES_AGENT_DIR`, `HERMES_PYTHON` | from `HERMES_HOME` | Hermes code and its Python, for the gateway bridge |
| `HERMES_URL` | `http://127.0.0.1:8642` | Hermes API server |
| `HERMES_PANEL_URL` | — | Link to the Hermes dashboard in Settings |
| `DATA_DIR` | `./data` | Database, files, keys |
| `CHAT_CONFIG` | `./config.yaml` | Username and password file |
| `VAULT_PATH` | from Hermes `.env` | Obsidian vault |
| `VAPID_SUBJECT` | the chat's URL | Contact for push services |
| `ROUTER_URL` | — | Only if a process manager stops the chat when idle (see `.env.example`) |

`config.yaml` holds the single user's `username` and `password` (created by `npm run setup`). It is re-read when
it changes; changing the password signs out every device. `allow_password: true` re-enables password sign-in
if you lose all passkeys.

## Updating

```sh
git pull && npm ci && npm run build   # then restart the service
```

Database migrations run automatically on start. Read [CHANGELOG.md](CHANGELOG.md) before upgrading.

## Backups

Everything lives in `data/`: `chat.db` (chats, messages), `uploads/` (attached files), and keys
(`.session-secret`, `.vapid.json`, `.hermes-hook-token`). Stop the chat and copy the directory, or back up
`chat.db` live with `sqlite3 data/chat.db ".backup backup.db"`. Conversation history is also kept by Hermes itself.

## Development

```sh
npm ci
npm run dev        # server + Vite with hot reload on http://127.0.0.1:5190
npm run check      # types, lint, tests and production build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Limitations

- Single user by design.
- Conversations from Telegram or the terminal are not shown here — the chat only sees its own Hermes sessions.
- Hermes waits `approvals.timeout` seconds (in `~/.hermes/config.yaml`) for a permission answer and then
  treats it as denied; this setting is shared by all Hermes channels.
- The UI is in Ukrainian.

## License

[MIT](LICENSE). Hermes Chat is an independent project and is not affiliated with Nous Research.
