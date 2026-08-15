# Security Policy

## Threat model — read this first

AI Calendar is a **single-user, self-hosted tool**. The whole security posture
follows from that: the safe configuration is the one you get by doing nothing.

By default the server:

- **binds `127.0.0.1`** (loopback only) — nothing off the machine can reach it;
- serves an **API key as *optional***: when `API_KEY` is unset, `/api/*` is open,
  because the loopback bind is the guard. When `API_KEY` is set, every `/api/*`
  request must present it (constant-time compared) or gets `401`;
- **scopes CORS** to the Vite dev origin (`http://localhost:5173`), not `*`;
- stores OAuth tokens as `0600` JSON under `server/data/` (git-ignored);
- warns loudly at startup if you bind a non-loopback interface without a key.

`/health` never requires the key, so liveness can always be checked.

### If you expose it beyond localhost

You are leaving the design envelope. Do **all** of:

1. Set a strong `API_KEY`.
2. Set an explicit `CORS_ORIGIN` (never `*`).
3. Put it behind TLS (a reverse proxy).
4. **Add a rate limiter** (at the proxy, or `express-rate-limit`). Per-request
   work is bounded, but nothing caps request *volume* — that's fine on loopback,
   not on a public interface.
5. Understand that OAuth token storage is **dev-grade single-user** — plaintext
   JSON, not a multi-tenant secret store.

The server refuses to pretend otherwise: a non-loopback bind with no `API_KEY`
prints a warning on every start.

## What is in scope

The Express interrogation API (`server/`) and its four providers
(`local`, `google`, `outlook`, `caldav`). The React client (`client/`) is a
thin consumer of that API.

## Trust boundaries

| Boundary | What crosses it | Control |
|---|---|---|
| Network → API | every HTTP request | loopback bind; optional `API_KEY` (constant-time) |
| API → filesystem | `local` provider store, OAuth tokens | fixed store path; token filename from a **whitelisted** provider id; tokens `0600` |
| API → CalDAV/Graph/Google | outbound requests carrying credentials | `calendarId` must **exactly match** a configured collection (no SSRF); ids URL-encoded into paths |
| Stored data → other consumers | event fields (title, etc.) | control bytes stripped on write; the API stores raw and expects consumers to escape at their own output layer |

## Hardening already in place

These were verified by an adversarial audit (2026-08-16) — attacked against a
live server, not just read:

- **No SSRF via CalDAV.** `calendarId` is resolved against the configured
  collection URLs before any outbound request; an arbitrary URL is rejected
  with `400`, so the account's Basic-auth header can never be sent to an
  attacker-named host or a cloud metadata endpoint.
- **Bounded work per request.** The availability engine caps its slot scan
  (`MAX_SLOT_ITERATIONS`), recurrence expansion and series enumeration cap at
  `MAX_INSTANCES_PER_SERIES`, and the JSON body / ICS import are size-limited —
  so no single request can pin the single-threaded server.
- **OAuth CSRF protection.** The `state` token is issued server-side and
  verified (one-time, 10-min TTL) on the callback before the code is used.
- **Constant-time API-key comparison** (`safeKeyEquals`) — no timing side channel.
- **No prototype pollution.** JSON `__proto__` / `constructor` become own-keys;
  the object-spread merges used on update do not walk the prototype chain.
- **Injection-safe.** Provider ids are whitelisted; ICS output escapes CR, LF
  and structure characters in every field; remote ids are URL-encoded.
- **Baseline response headers**: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: same-origin`.
- **No verbose error leakage.** Upstream provider error bodies are logged
  server-side, not echoed to the client.

## Invariants for contributors

Do not reintroduce these. Each maps to a fixed vulnerability:

1. **Never fetch a caller-supplied value as a URL.** Any `calendarId` /
   collection reaching `fetch()` must be validated against configured URLs
   first (see `caldav.js` `resolveTargets`).
2. **Never interpolate a caller id into a URL path unencoded** — use
   `encodeURIComponent`.
3. **Every loop driven by request input needs a hard cap** (window size,
   granularity, occurrence count).
4. **Escape CR *and* LF** in anything written to iCalendar or a header.
5. **Verify OAuth `state`** on any new callback path.
6. **Validate and bound new input fields** in `parseEventBody` (length, count,
   control characters) — don't trust the client.
7. **Keep secrets out of client-facing error messages and out of git**
   (`server/data/`, `server/.env` are ignored — keep it that way).

There is a security regression suite at `server/test/security.test.js`. Run
`npm test` before submitting; add a test for any new input path.

## Reporting a vulnerability

This is a personal open-source project, not a funded program. If you find an
issue, please open a GitHub issue describing it (for a sensitive one, mark it
clearly and keep the detail minimal until it can be discussed). There is no
bounty, but credit is given.

## Dependencies

Runtime deps are kept minimal (`express`, `googleapis`, `node-ical`, `rrule`)
and `npm audit` is expected to report **0 vulnerabilities**. Node **20+** is
required. Run `npm audit` after any dependency change.
