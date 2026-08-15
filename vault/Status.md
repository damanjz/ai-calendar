---
title: AI Calendar — Status
project: AI Calendar
type: status
tags:
  - project/ai-calendar
  - status
updated: 2026-08-16
---

# AI Calendar — Status

> Current state and what's next. Keep this short; move finished items to [[Changelog]].

## Now
- **Published:** https://github.com/damanjz/ai-calendar (public, MIT). `master` at 17 commits.
- Full UI pass: Month/Week/Day/Agenda views, drag & drop rescheduling, sidebar multi-calendar + colors, conflict-checked booking modal with edit/delete.
- Provider-agnostic interrogation API: providers behind one contract (`local`/`google`/`outlook`/`caldav`); only `local` is ready+active (no credentials configured yet).
- **163 tests / 92.2% line coverage** (`node:test`, no test-framework dependency). Lint clean; `npm run build` passes. **0 npm vulnerabilities.**
- **Recurring events expand** to one instance per occurrence across all four providers.
- **Series-scoped edit/delete** — `PATCH`/`DELETE` take `scope=this|following|all`.
- **Working hours + timezone** on availability (`workDays`/`workStart`/`workEnd`/`timeZone`, real IANA handling via `Intl`).
- **ICS import/export**, **text search** (`?q=`), **categories**, **reminders** (`/api/reminders`).

## In progress
- **⏸ Google live test — PARKED, blocked on Daman.** Everything is staged; the remaining step needs
  credentials + Google consent, which Claude can't do.
  1. OAuth creds at [console.cloud.google.com](https://console.cloud.google.com/) → Credentials →
     OAuth client ID → **Web application**; enable the Google Calendar API. Redirect URI exactly:
     `http://localhost:3000/api/auth/google/callback`
  2. Paste id + secret into `server/.env` (already scaffolded, git-ignored, no secrets in it yet).
  3. `API_PORT=3000 npm run dev`, then open `http://localhost:3000/api/auth/google` and consent.
     (Unverified-app warning is expected for your own client → Advanced → continue.)
     Token lands at `server/data/tokens-google.json`, mode `0600`.
  4. Then run `npm run verify:live -w server`.

  **What that checks** (`server/scripts/verify-live-provider.mjs`): read-only first — lists
  calendars, validates the normalized shape, asserts recurring series come back **expanded**,
  confirms availability never offers a slot overlapping a real event. Only then writes, in
  **January 2038** so it can't collide with anything real, deleting all it creates.

  **Prediction to check against:** read-only passes; the write path likely shows `recurrence` is
  dropped on create, since `toGoogleEvent` emits no RRULE.

## Next / backlog
- **Live providers:** Google is staged (above). Outlook + CalDAV still stub-verified only.
- **Recurrence UI** — a rule can only be set via the API today; no control in the booking modal.
- Persist `recurrence` on write for remote providers (`toGoogleEvent`/`toGraphEvent`/`toIcs` emit no rule, so *creating* a recurring event only works on `local`).
- `distinct=true` option on availability so slots don't overlap each other (08:00, 08:15, 08:30 for 30-min slots) — today "give me the first 3 slots" returns three near-identical times.
- Client-side series handling: drag-and-drop resolves by `id`, which is now an *instance* id. Dragging an occurrence PATCHes that instance — correct-ish, but untested and unexplained in the UI.
- Split `client/src/App.jsx` (322 lines: providers + views + drag/drop + modal orchestration) if it grows further. Under the 800-line ceiling, not urgent.
- Add a repo `CHANGELOG.md` mirroring `vault/Changelog.md`.
- Still deferred from the original scoping pick: Docker image · refresh-token rotation for long-running assistants.

## Known issues / risks
- ⚠ **No remote provider has ever run against a real account.** Google/Outlook/CalDAV pass against *stubbed transports*, which verifies our request shapes and normalisation — not the live APIs. **This is the single biggest open risk**, and every provider change made on 2026-08-15/16 sits behind it. Highest-risk change: the Outlook switch from `/me/events` to `/me/calendarView`, reasoned from Graph's documented behaviour and never executed. Google is staged to test — see *In progress*.
- **`scope` support is uneven across providers.** `local` implements all three; Google/Outlook do `this` and `all`; CalDAV only `all` (it rewrites the whole `.ics`). Unsupported scopes are rejected with `bad_request`, and the assistant guide tells the assistant to ask the user which scope they mean.
- **Creating a *recurring* event only works on `local`** — `toGoogleEvent`/`toGraphEvent`/`toIcs` emit no RRULE, so `recurrence` is silently dropped on write for remote providers.
- OAuth tokens in `server/data/` are `0600` JSON — still dev-grade single-user storage, not production multi-user auth.
- Availability slots overlap each other (08:00, 08:15, 08:30 for 30-min slots) — intentional and documented, but "the first 3 slots" returns three near-identical times. `distinct=true` is on the backlog.
- Client-side series handling is unexplained in the UI: drag-and-drop resolves by `id`, which is now an *instance* id, so dragging an occurrence PATCHes that instance. Correct-ish, but untested and never surfaced to the user.

### Resolved 2026-08-15/16
- ~~5 moderate `npm audit` findings~~ — **0 vulnerabilities** after googleapis 173 / node-ical 0.22.
- ~~No series-scoped edit/delete~~ — shipped (`scope=this|following|all`).
- ~~No timezone or working-hours handling~~ — shipped (`workDays`/`workStart`/`workEnd`/`timeZone`).
- ~~`/api/reminders` missed reminders whose event fell outside the window~~ — fixed in `583af5a`.
- ~~Oversized ICS returned `500`~~ — fixed; now a route-level `400` or a `413 payload_too_large`.
- ~~ICS export requested an ~8000-year window~~ — fixed; `getRawEvents` is on the contract, bounded ±1 year by default.
- ~~OAuth redirect URI ignored `API_PORT`~~ — fixed in `c70a870`; consent would have redirected to a dead port.

## Links
- [[AI Calendar]] · [[Decisions]] · [[Changelog]]
