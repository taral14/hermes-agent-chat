# Contributing

Thanks for helping! Bug reports, fixes, translations and docs are all welcome.

## Setup

```sh
npm ci
npm run setup     # config.yaml and .env for local development
npm run dev       # server + Vite with hot reload on http://127.0.0.1:5190
```

You need Hermes Agent running locally for conversations; the knowledge base, settings and most of the UI work
without it.

## Before opening a pull request

```sh
npm run check     # typecheck (app, server, tests) + oxlint + node:test + production build
```

- Keep changes focused; one topic per pull request.
- Match the surrounding code: small modules, comments that explain *why*, no new dependencies without a reason.
- The server is TypeScript run directly by Node (type stripping): use only erasable syntax (no enums,
  no parameter properties) and `.ts` extensions in imports.
- New behaviour in pure modules (`src/schedule.ts`, `src/router.ts`, `server/http.ts`, …) should come with a test
  in `test/`.
- UI text is Ukrainian today. If you add strings, keep them in Ukrainian or start the i18n work (see below).

## Translations

The interface is Ukrainian only. Adding i18n is the most wanted contribution: extract strings from
`src/components` into a dictionary module, add English, and pick the language from the browser.
Open an issue first so we can agree on the approach.

## Hermes compatibility

The chat depends on the Hermes gateway protocol, `~/.hermes/cron` job fields and the webchat plugin API.
When Hermes changes, update `HERMES_TESTED` in `scripts/doctor.ts`, note it in `CHANGELOG.md`, and say which
Hermes version you tested with in the pull request.

## Releasing

1. Update `CHANGELOG.md` and `version` in `package.json` (and `hermes-plugin/webchat/plugin.yaml` if the plugin
   changed).
2. `npm run check`.
3. Tag: `git tag v0.x.y && git push --tags`, then create a GitHub release with the changelog section and the
   tested Hermes version.
