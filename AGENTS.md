# Notes for coding agents

Read `CONTRIBUTING.md` (setup, checks) and `docs/ARCHITECTURE.md` (how the pieces fit) first.

## Workflow

- `npm run check` must pass before every commit: typecheck (app, server, tests), oxlint, `node:test`, build.
- Node 22.18+ runs the server's TypeScript directly: erasable syntax only (no enums, no parameter properties),
  `.ts` extensions in imports.
- Add dependencies with `npm install <pkg>` so `package-lock.json` stays in sync (deployments run `npm ci`).
- No force pushes to `main`, no history rewrites.

## Must keep working

- `npm start` serves production and MUST listen on `process.env.PORT`.
- `npm run build` builds the client into `dist/`.
- A restart must not lose Hermes runs: the server picks up unfinished ones on start.

## Never commit

`config.yaml`, `.env`, `data/` (database, uploads, session secret), `dist/`, `node_modules/`. They are in
`.gitignore`; keep it that way.

## Security

- Routes that change state use POST/PATCH/DELETE and `readJson`, which enforces the same-origin check and
  `application/json`. GET never changes anything.
- Do not weaken the CSP in `PAGE_HEADERS` (`server/http.ts`) or the `DENY` list in `server/media.ts`.
- See `SECURITY.md` for the threat model.
