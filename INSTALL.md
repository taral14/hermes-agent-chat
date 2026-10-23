# Install Hermes Chat with Hermes

This file is written for Hermes Agent: give it to Hermes and it installs the chat on the machine it runs on.
Tell Hermes, for example:

> Install Hermes Chat by following https://raw.githubusercontent.com/taral14/hermes-agent-chat/main/INSTALL.md

People who prefer to do it by hand: the same steps are in [README.md](README.md#install).

---

## Instructions for Hermes

You are installing Hermes Chat, a web chat for you (Hermes Agent), on the machine you run on. Work through
the steps in order. Run the commands yourself with the terminal tool, and tell the user what you are doing in
short updates, in the user's language.

Rules:

- **Ask before you change anything outside the chat's folder**: `~/.hermes/.env`, `~/.hermes/config.yaml`,
  launchd/systemd services, DNS or tunnels. Say what you will change and why, then wait for a yes.
- **Ask the user these questions once, at the start**, and propose the default:
  1. Where to put the chat? Default: `~/hermes-agent-chat`.
  2. Run it as a background service that starts with the computer? Default: yes.
  3. Should you (Hermes) be able to post into the chat: scheduled-task results and `send_message`? Default: yes.
  4. Will they open it from a phone? If yes, which domain (e.g. `chat.example.com`) and do they already have
     a tunnel or reverse proxy? Default: no, this computer only (`http://localhost:5190`).
- **The login password** is printed once by `npm run setup`. Show it to the user in your reply and tell them to
  save it in a password manager. Do not write it into memory, notes, files or skills.
- **Never restart your own gateway in the middle of the work.** If a step needs `hermes gateway restart`, do it
  last, after your final report (step 9).
- If a command fails, read the error, fix the cause and rerun; `npm run doctor` explains most problems.
  Do not delete `data/`, `config.yaml` or `.env` of an existing install.

### 1. Check the requirements

- OS: macOS or Linux (`uname -s`).
- Node.js **22.18 or newer**: `node --version`. If missing or older, propose installing it
  (macOS: `brew install node`; Linux: the distribution's package for Node 22+, or `nvm install 22`).
- Git: `git --version`.
- Your own version: Hermes Agent **0.22 or newer** (`hermes --version`). If older, tell the user to update
  Hermes first (`hermes update`) and stop.

### 2. Make sure your API server is on

The chat talks to you through your gateway and your API server (scheduled tasks, models, session titles).

- `hermes config get API_SERVER_ENABLED` must be `true`, and `API_SERVER_KEY` must be set in
  `hermes config env-path`. Check for the key without printing it:
  `grep -c '^API_SERVER_KEY=.' "$(hermes config env-path)"` (1 means it is set).
- If either is missing, ask the user, then:
  ```sh
  hermes config set API_SERVER_ENABLED true
  hermes config set API_SERVER_KEY "$(openssl rand -hex 24)"
  ```
  The API server starts with the gateway, so this needs a gateway restart: do it in step 9 and run
  `npm run doctor` again after it.
- The chat reads the key from your `.env` itself; nothing is copied into the chat.

### 3. Download and build

```sh
git clone https://github.com/taral14/hermes-agent-chat.git ~/hermes-agent-chat   # or the folder the user chose
cd ~/hermes-agent-chat
npm ci
npm run setup     # creates config.yaml (username + random password, printed once) and .env
npm run build
```

`npm run setup` uses the computer's user name as the login. To choose another: `npm run setup -- <name>`.
It never overwrites an existing `config.yaml` or `.env`.

### 4. Configure `.env` (only if needed)

The defaults work on this computer: the chat finds your folder (`~/.hermes`) and your Python by itself. Edit `.env` in the chat folder only for these cases:

- **Phone access**: set `PUBLIC_HOST=<domain>` (without `https://`). Passkeys, share links and push notifications
  are bound to this domain.
- **Port 5190 is taken** (`lsof -i :5190` on macOS, `ss -ltn` on Linux): set `PORT=<free port>`.
- **Hermes lives elsewhere** than `~/.hermes`: set `HERMES_HOME`.

Every variable is explained in `.env.example`.

### 5. Check

```sh
npm run doctor
```

Fix every line marked `✗`, then run it again. Lines marked `⚠` are optional; they are handled in the next steps.
`doctor` prints in Ukrainian. If you just turned the API server on in step 2, one `✗` is expected until the
restart in step 9: `API-сервер не відповідає` (the API server does not respond). Everything else must pass.

### 6. Start the chat

**If the user wants a service** (recommended):

- macOS: write `~/Library/LaunchAgents/com.hermes-chat.plist`. Use the real paths: `command -v npm`, the chat
  folder, and a `PATH` that contains the folder of `node`.
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>com.hermes-chat</string>
    <key>ProgramArguments</key>
    <array><string>/opt/homebrew/bin/npm</string><string>start</string></array>
    <key>WorkingDirectory</key><string>/Users/USER/hermes-agent-chat</string>
    <key>EnvironmentVariables</key>
    <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/Users/USER/Library/Logs/hermes-chat.log</string>
    <key>StandardErrorPath</key><string>/Users/USER/Library/Logs/hermes-chat.log</string>
  </dict>
  </plist>
  ```
  Then: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hermes-chat.plist`
- Linux: write `~/.config/systemd/user/hermes-chat.service` with the real paths:
  ```ini
  [Unit]
  Description=Hermes Chat
  [Service]
  WorkingDirectory=%h/hermes-agent-chat
  ExecStart=/usr/bin/npm start
  Environment=PATH=/usr/local/bin:/usr/bin:/bin
  Restart=always
  [Install]
  WantedBy=default.target
  ```
  Then: `systemctl --user daemon-reload && systemctl --user enable --now hermes-chat`, and
  `loginctl enable-linger "$USER"` so it keeps running after logout (ask first: it may need sudo).

**Without a service**: start it in the background so your terminal is not blocked:
`nohup npm start > chat.log 2>&1 &`. Tell the user it stops when the computer restarts.

Wait until it answers (up to ~20 s): `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5190/api/ping`
must print `204` (use the port from `.env` if you changed it). If not, read the log.

### 7. Let yourself post into the chat (if the user said yes)

The chat must have started once (step 6): it creates the key the plugin uses.

```sh
npm run setup:hermes
```

This copies the `webchat` plugin into `~/.hermes/plugins/webchat` and enables it. If that folder already exists,
it belongs to another copy of this chat: ask before overwriting it. The plugin starts working after the gateway
restart in step 9.

### 8. Optional extras

- **Time zone.** If `hermes config get timezone` is empty, propose setting it to this computer's zone
  (`node -p 'Intl.DateTimeFormat().resolvedOptions().timeZone'`), e.g. `hermes config set timezone Europe/Kyiv`.
  Without it the first scheduled run after a daylight-saving change can be an hour off.
- **Obsidian knowledge base.** The chat's "Knowledge base" section is off unless `VAULT_PATH` is set in the chat's
  `.env`. Ask the user whether they keep notes in an Obsidian vault and which folder it is. If you already write
  notes to a vault (for example `OBSIDIAN_VAULT_PATH` in your `.env`), suggest that folder. Then set
  `VAULT_PATH=<absolute path>` in the chat's `.env` and restart the chat. If they don't use Obsidian, skip this.
  On macOS, when the vault is in iCloud Drive (`~/Library/Mobile Documents/…`) and the chat runs as a service,
  the service cannot read it: run `npm run setup:vault-mirror` (it keeps a copy in `data/vault/`).
- **Phone access.** The server listens on `127.0.0.1` only; it needs HTTPS in front of it. If the user has
  Cloudflare, a tunnel is the easiest: `cloudflared tunnel login` (opens a browser: the user signs in there),
  `cloudflared tunnel create hermes-chat`, `cloudflared tunnel route dns hermes-chat <domain>`, then run
  `cloudflared tunnel run --url http://127.0.0.1:5190 hermes-chat` as a service like in step 6. With Caddy:
  `<domain> { reverse_proxy 127.0.0.1:5190 }`. After `PUBLIC_HOST` changes, restart the chat.

### 9. Report, then restart the gateway if needed

1. Run `npm run doctor` once more and fix what you can.
2. Report to the user:
   - the address (`http://localhost:5190`, or `https://<domain>`), the login and the password from step 3;
   - next steps for them: sign in, open **Settings → Account → Sign-in and security**, add a passkey
     (Face ID / Touch ID) and turn password sign-in off; on iPhone add the site to the Home Screen
     (Share → Add to Home Screen) to get push notifications;
   - what you changed outside the chat folder;
   - anything left to do.
3. If you enabled the API server (step 2) or installed the plugin (step 7), the gateway must restart. Say that
   you will restart yourself now and the conversation will pause for a moment, then run `hermes gateway restart`.
   After it, the user can check with `npm run doctor` in the chat folder, or ask you to post a test message:
   `hermes send -t webchat:Test "hello"`.

### Updating later

```sh
cd ~/hermes-agent-chat && git pull && npm ci && npm run build
```

Then restart the service (`launchctl kickstart -k gui/$(id -u)/com.hermes-chat`, or
`systemctl --user restart hermes-chat`). If the update changed the plugin, run `npm run setup:hermes` again and
restart the gateway as in step 9. Read `CHANGELOG.md` first.
