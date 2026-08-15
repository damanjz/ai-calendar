---
title: Architecture — AI Calendar
project: AI Calendar
type: architecture
tags:
  - project/ai-calendar
  - architecture
updated: 2026-08-16
---

# Architecture — AI Calendar

> How it's built. Repo: `G:\Claude Projects\ai-calendar` (npm workspaces: `client/` + `server/`) · https://github.com/damanjz/ai-calendar

## Shape

```
ai-calendar/
├─ package.json            # workspaces + concurrently scripts
├─ client/                 # @ai-calendar/client — React + Vite UI (port 5173)
├─ server/                 # @ai-calendar/server — Node/Express API (port 3000)
└─ vault/                  # these project notes (travel with the code)
```

Dev run: root `npm run dev` starts both via `concurrently`. Vite dev proxy forwards `/api` and `/health` to the API, so the UI and any browser-based client talk one origin. ⚠ Set **`API_PORT`**, not `PORT`.

## Server (interrogation API)

| Piece | Path | Role |
|-------|------|------|
| App | `server/src/app.js` | builds the Express app (CORS, error middleware) — **no `listen()`** |
| Entry | `server/src/server.js` | binds the port + startup safety warnings |
| Routes | `server/src/router.js` | All `/api/*` + `/health` + auth routes |
| Providers | `server/src/providers/` | `base.js` (contract), `local.js`, `google.js`, `outlook.js`, `caldav.js`, `index.js` (registry) |
| Auth | `server/src/auth/store.js` | OAuth token JSON storage, written `0600` |
| Lib | `server/src/lib/` | `errors.js`, `util.js` (`findFreeSlots`, working hours, `safeKeyEquals`), **`recurrence.js`**, **`ics.js`**, `validate.js`, `fs-store.js` |
| Config | `server/src/config.js` | env-driven (`.env.example` template). Resolves the bind port **once**; OAuth redirect URIs derive from it |
| Seed | `server/src/seed.js` | resets local calendar to empty state |
| Tests | `server/test/` | 13 files — `util`, `validate`, `config`, `providers`, `google-provider`, `remote-providers`, `recurrence`, `recurrence-providers`, `series-scope`, `ics`, `search-reminders`, `review-findings`, `api` |
| Live check | `server/scripts/verify-live-provider.mjs` | real-account harness (`npm run verify:live -w server`) — **not** part of `npm test` |
| Data | `server/data/local-calendar.json` | `local` provider store (git-ignored) |

`app.js` is split from `server.js` so tests can drive the **real** app on an ephemeral port without starting the production listener.

Endpoints: `/health` · `/api/providers` · `/api/calendars` · `/api/events` · `/api/availability` · `/api/conflicts` · `/api/book` · `PATCH`/`DELETE /api/events/:eventId` · `/api/auth/:provider` + `/callback`.

Event model (normalized): `{ id, provider, calendarId, title, description, location, start, end, allDay, attendees }` — ISO 8601 UTC. Expanded recurrence instances add `recurringEventId` + `originalStart`; a write may carry `recurrence`.

Flow for assistants (see `server/docs/assistant-guide.md`): health → providers → calendars → events window → availability → conflicts → book → patch/delete.

## Recurrence (why it's shaped this way)

`findFreeSlots` is **purely interval-based** — it reads `start`/`end` and nothing else. A recurring master carrying an RRULE would therefore block only its first occurrence, and a series beginning before the window is removed by the window filter entirely, so every occurrence reads as free.

Expansion happens **inside each provider's `getEvents`**, not in a shared wrapper: `getEvents` has three call sites (`base.js` availability, `router.js` raw read, `router.js` conflicts), so a wrapper would need applying three times and any future call site would silently bypass it.

| Provider | Expansion |
|---|---|
| `google` | `singleEvents: true` — Google expands server-side |
| `outlook` | `/me/calendarView` — Graph expands. The plain `/events` collection **ignores the date range** and returns series masters |
| `caldav` | `node-ical` parses the RRULE but never expands; occurrences generated with `rrule`, honouring `EXDATE` + `RECURRENCE-ID` |
| `local` | expanded in-process from the stored rule, **before** the window filter |

Capped at 1000 instances per series, stopping *at* the cap rather than materialising then slicing.

## Security posture

Single-user, self-hosted — defaults chosen to match: binds `127.0.0.1`; CORS defaults to the UI origin (not `*`); `API_KEY` compared in constant time; OAuth tokens `0600`; startup warns if bound off-loopback without a key.

## Client (UI)

| Area | Path | What |
|------|------|------|
| Orchestration | `client/src/App.jsx` | provider/calendar state, view windows, visibility, fetch, drag-move, modal lifecycle, error banner |
| Views | `client/src/components/` | `MonthView` (42-cell grid), `WeekView` (24h grid), `DayView`, `AgendaView` (next 14 days) |
| Chrome | `client/src/components/` | `Sidebar` (providers + calendars + colors), `ViewSwitcher`, `BookingModal`, `Event.jsx` |
| Lib | `client/src/lib/` | `datetime.js` (view windows), `api.js` (fetch wrapper), `colors.js` (palette + prefs), `layout.js` (overlap-aware day layout) |
| Styles | `client/src/App.css`, `index.css` | header/sidebar/views/modal, responsive 900px/640px |
| Proxy | `client/vite.config.js` | `/api`, `/health` → `http://localhost:3000` |

Key behaviors:
- **Drag & drop:** month = move chip to another day; week/day = drag block to a time slot (15-min snap). Duration preserved; `PATCH` persists the move.
- **Conflicts:** server-side `POST /api/conflicts`; booking modal blocks unless "Book anyway (double-book)" is checked.
- **Colors/visibility:** per-calendar, persisted to localStorage `ai-calendar.prefs.v1`.

## Data flow
1. UI asks `/api/calendars?provider=...` for calendars.
2. Per view, computes a date window via `datetime.js` and fetches `/api/events?provider=...&from=...&to=...`.
3. `layout.js` groups/positions events (overlap-aware) for week/day.
4. Booking: modal → `/api/conflicts` → `/api/book` (or `PATCH` for edit).
5. `local` provider reads/writes `server/data/local-calendar.json` on each request (no restart needed).

## Series scope, working hours, ICS

- **`scope=this|following|all`** on `PATCH`/`DELETE`. `local` implements all three: `this` stores a
  per-occurrence exception, `following` splits the series (caps the old rule with `UNTIL`, re-anchors
  a new master, partitions exceptions across the split point). Google/Outlook do `this` and `all`
  natively; CalDAV only `all`. Unsupported scopes → `bad_request`.
- **Working hours** — `workDays` / `workStart` / `workEnd` / `timeZone` on availability, with real
  IANA handling via `Intl` rather than offset arithmetic.
- **ICS** (`lib/ics.js`) — parsing via node-ical, serialisation by a small writer. Export is bounded
  (±1 year by default) because an unbounded range is a full-history sweep of a remote API; `local`
  ignores the window and exports its whole store so its export stays complete.

## Paired limits

Two constants each drive a second value, so the pair cannot drift:
- `MAX_REMINDER_LEAD_MINUTES` (validate.js) → how far ahead `/api/reminders` looks for events whose
  trigger falls in the window.
- `MAX_ICS_BYTES` (ics.js) → the JSON body limit in app.js, so the route's own size check is what
  fires rather than body-parser failing first.

Both existed as bugs first: a route checking 5 MB behind a 1 MB parser, and a reminder window that
ignored how far ahead a reminder can be set.

## Verification (2026-08-16)
- `npm test` — **163 tests, 0 failures**; `npm run test:coverage` — **92.2% lines** (`util.js` 100%,
  `local.js` 97.9%, `recurrence.js` 97.6%). `npm audit` — **0 vulnerabilities**.

### Earlier (2026-08-15)
- `npm test` — 118 tests, 0 failures; **90.7% lines** (`util.js` and `local.js` at 100%).
- `npm run lint` — 0/0 both workspaces.
- `npm run build` — passes (client).
- E2E through proxy — book → PATCH reschedule → DELETE all succeeded; `/api/availability` returns slots; data reset to 0 events.
- Recurrence E2E in a browser — booked a weekly series, confirmed the **third** occurrence was reported busy and withheld from availability.

> [!warning] What is NOT verified
> Google, Outlook and CalDAV have **never run against real accounts**. They pass against *stubbed transports*, which proves our request shapes and normalisation — not the live APIs. The Outlook `/calendarView` switch is reasoned from Graph's documented behaviour and is the highest-risk unexecuted change.

Back to [[AI Calendar]].
