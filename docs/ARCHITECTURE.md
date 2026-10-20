# Architecture

Hermes Chat is one Node.js process that serves a React single-page app and talks to Hermes Agent running on the
same machine. There is no separate database server: everything is in a SQLite file under `data/`.

```
Browser (React PWA) ──HTTPS──▶ proxy/tunnel ──▶ server (Node, node:http, node:sqlite)
                                                  │  ├─ gateway bridge (Python, Hermes' own client) ──▶ ~/.hermes/gateway.sock
                                                  │  ├─ Hermes API server (HTTP, 127.0.0.1:8642): jobs, models, session titles
                                                  │  └─ Obsidian vault (files, fs.watch)
Hermes ── webchat plugin ──POST /api/hooks/hermes─┘  (scheduled-task results, send_message)
```

## Server (`server/`)

| File | Role |
|---|---|
| `index.ts` | Boots everything: static files and the SPA, the route table, background timers, shutdown |
| `http.ts` | Responses, body parsing (1 MB JSON limit), CSRF check, client IP, security headers |
| `session.ts` | `config.yaml`, signed session cookies backed by the `sessions` table, sign-in rate limits |
| `events.ts` | Server-sent events hub (`/api/events`) and the public view of a chat |
| `routes/*.ts` | One module per area: `auth`, `chats`, `files`, `share`, `jobs`, `kb`, `plugins`, `push`, `settings`, `hooks` |
| `gateway.ts` + `bridge.py` | Long-lived bridge to the Hermes gateway; reconnects with backoff |
| `native.ts` | Translates gateway events into message parts; send, steer, stop, rewind, branch, slash commands |
| `live.ts` | In-memory state of messages Hermes is working on; batching saves and broadcasts |
| `hermes.ts`, `jobs.ts` | Client for the Hermes HTTP API (models, session titles, scheduled jobs and their runs) |
| `plugins.ts` | Plugins = Hermes MCP servers: catalog, install, enable/disable, OAuth sign-in, `reload.mcp` |
| `jobLinks.ts` | Which scheduled job delivers into which chat (`deliver=webchat:<chat id>`) |
| `inbox.ts` | Messages Hermes sends on its own (plugin hook), job chats |
| `media.ts` | `MEDIA:/path` attachments from Hermes, the deny-list of secret paths, upload sweeping |
| `vault.ts` | Obsidian vault index, wiki-link resolution, graph, search, live watching |
| `unfurl.ts` | Link previews with SSRF protection (DNS checked at connect time, redirects re-checked) |
| `push.ts` | Web push (VAPID), presence (no push for a chat you are looking at), mute per chat |
| `db.ts` | SQLite schema and versioned migrations (`PRAGMA user_version`) |

### Talking to Hermes

Conversations use the gateway's native JSON-RPC protocol — the same one the Hermes TUI and desktop app use.
`bridge.py` runs with Hermes' own Python and its official `hermes_cli.gateway_client`, which obtains a ticket on
the owner-only socket `~/.hermes/gateway.sock`; the Node side exchanges newline-delimited JSON with it.

Each chat is a Hermes session. `prompt.submit` sends a message; the gateway answers with an `admission_id`
and streams events (`message.delta`, `tool.start`, `approval.request`, `message.complete`, …).
Events can arrive before the submit receipt; `native.ts` buffers events with an unknown admission while a
receipt is pending and replays them once it knows which turn is ours, so a `/loop` or heartbeat turn that starts
at the same moment is never attached to the wrong message.

Hermes keeps the conversation history; the chat stores what it shows (text, attachments and the work steps).
Per-request context (chat rules, the chat id for scheduled tasks, attached file paths) goes to the model via
`api_text` and does not end up in the visible history.

### Plugins (MCP servers)

The plugins page is a view over Hermes' own MCP management, nothing is reimplemented. Besides JSON-RPC
(`mcp.servers.list`, `mcp.servers.status`, `mcp.servers.add`, `reload.mcp`), the bridge calls the gateway's HTTP
routes (`/api/mcp/catalog`, `/api/mcp/servers/<name>/enabled|test|auth`, `/api/mcp/oauth/flows/<id>`) with a one-time
`native-http` ticket from the same owner-only socket. A catalog install takes the block Hermes itself would write
(`card_install_config`, with the curated tool filter) and saves it through `mcp.servers.add`; changes are applied
with one debounced `reload.mcp` that waits for running replies to finish.

OAuth sign-in state lives in the gateway process, which listens on loopback only. So the server's
`oauth.redirect_uri` points at the chat (`/api/plugins/oauth/<name>`, a public route), and the chat relays `code` and
`state` to the gateway's callback. Hermes checks `state`, so the route can stay public — on a phone the service's
page opens in a browser that has no chat cookie. Services with a pinned loopback redirect (Asana) fall back to
pasting the redirected address.

### Long tasks survive closed tabs

The server, not the browser, follows a running turn. It saves every event to SQLite and broadcasts it over SSE,
so you can close the tab in the middle of a long research task. After a server restart, unfinished turns are
re-attached and reconciled against the session snapshot.

### Scheduled tasks

Jobs live in Hermes. The chat lists and edits them through the Hermes API and reads `deliver` to know which
chat a job writes to. Every request from a chat tells Hermes that chat's id and the jobs linked to it, so
«pause this» or «move it to 9:00» in the conversation is done by Hermes itself with `cronjob_manage`.
Results arrive through the `webchat` plugin as messages with a «Task name ›» header.

## Client (`src/`)

| Path | Role |
|---|---|
| `App.tsx` | Layout, sheets, wiring between the route, the chat store and the views |
| `router.ts` | The URL is the single source of the route; `navigateTo()` is the only way to navigate |
| `hooks/useChats.ts` | Chats, messages, lists; SSE subscription; optimistic actions with resync on failure |
| `bus.ts` | Typed events between distant parts (open a note, a job, the login screen). `emit()` reports whether anyone handled the event, so links fall back to normal navigation on the public share page |
| `http.ts`, `api.ts` | The only fetch path: JSON, typed errors, automatic return to sign-in on 401 |
| `components/ChatPane.tsx` | An open chat: header, thread, scrolling, composer |
| `components/MessageView.tsx`, `components/message/*` | Messages, work steps, permission cards, attachments, job chips |
| `components/ui/*` | Shared `Sheet` (Escape closes only the top layer, focus trap), `Switch`, `TopBar`, `ErrorBoundary` |
| `hooks/useJobForm.ts` | One form model for a scheduled job, used by the job page and the in-chat sheet |
| `kb.ts`, `components/Kb*.tsx` | Knowledge base views and turning note mentions in answers into links |

The thread re-renders only messages that changed: the actions context is stable while a reply streams, and
`MessageView` is memoised. Each message has its own error boundary.

## Data

`data/chat.db` tables: `chats`, `messages`, `uploads`, `lists`, `shares`, `sessions`, `passkeys`, `push_subs`,
`settings`, `link_previews`, `download_links`. Files: `data/uploads/<id>/<name>`. Keys: `.session-secret`,
`.vapid.json`, `.hermes-hook-token`.

Large files Hermes produces are not copied: the upload row points at the original path, and downloads use a
one-hour link (`/dl/<token>/<name>`) that supports range requests.
