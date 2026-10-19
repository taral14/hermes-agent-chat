# Security

Hermes Chat gives whoever signs in control over an AI agent that can run commands on your computer.
Treat access to it like SSH access.

## Model

- **One user.** Credentials are in `config.yaml`; passkeys are recommended and password sign-in can be turned off.
- **Local server.** It listens on `127.0.0.1` only; expose it through an HTTPS proxy or tunnel.
- **Sessions** are random ids signed with a server secret and the password, stored server-side, so signing out
  or changing the password revokes them. They last 90 days; you can see and revoke them in the app.
- **Brute force.** 5 failed attempts from one address pause it for a minute; 20 failed password attempts in
  15 minutes from all addresses pause password sign-in for 15 minutes (persisted across restarts).
  Proxy headers (`CF-Connecting-IP`, `X-Forwarded-For`) are trusted only from localhost.
- **CSRF.** State-changing requests must come from the chat's own origin (`Origin`/`Sec-Fetch-Site`), JSON only.
- **Content.** Strict CSP (own scripts only), no framing. User and Hermes files are served with a sandboxing CSP.
  Images from other sites in Hermes' answers load only after a click, so a prompt-injected page cannot exfiltrate
  data through an image URL.
- **Files from Hermes.** `MEDIA:` paths are checked against a deny-list (SSH and cloud keys, Hermes and other
  tool tokens, browser profiles, the chat's own secrets), including symlink targets.
- **Outbound requests.** Link previews never reach private networks (checked at connect time, on every redirect).
  Push is only sent to Apple, Google, Mozilla and Microsoft push services.
- **Hermes hook.** `/api/hooks/hermes` requires a random token from `data/.hermes-hook-token` and is refused
  through Cloudflare.
- **Share links** show text and copied attachments only — never the agent's work steps or files that stayed on
  disk — and are `noindex`. Deleting a link revokes it immediately.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **Report a vulnerability** (private security advisory) on this
repository. Include steps to reproduce and the version (`Settings → About`). You will get a reply within a week.
