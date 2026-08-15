---
title: Architecture — AI Calendar
project: AI Calendar
type: architecture
tags:
  - project/ai-calendar
  - architecture
updated: 2026-08-15
---

# Architecture — AI Calendar

> How it's built. Repo: `C:\Demon Projects\ai-calendar` (npm workspaces: `client/` + `server/`).

## Shape

```
ai-calendar/
├─ package.json            # workspaces + concurrently scripts
├─ client/                 # @ai-calendar/client — React + Vite UI (port 5173)
└─ server/                 # @ai-calendar/server — Node/Express API (port 3000)
```

Dev run: root `npm run dev` starts both via `concurrently`. Vite dev proxy forwards `/api` and `/health` to `http://localhost:3000`, so the UI and any browser-based client talk one origin.

## Server (interrogation API)

| Piece | Path | Role |
|-------|------|------|
| Entry | `server/src/server.js` | Express app + CORS middleware |
| Routes | `server/src/router.js` | All `/api/*` + `/health` + auth routes |
| Providers | `server/src/providers/` | `base.js` (contract), `local.js`, `google.js`, `outlook.js`, `caldav.js`, `index.js` (registry) |
| Auth | `server/src/auth/store.js` | OAuth token JSON storage (dev-grade) |
| Lib | `server/src/lib/` | `errors.js`, `util.js` (incl. `findFreeSlots`), `validate.js`, `fs-store.js` |
| Config | `server/src/config.js` | env-driven (`.env.example` template) |
| Seed | `server/src/seed.js` | resets local calendar to empty state |
| Data | `server/data/local-calendar.json` | `local` provider store |

Endpoints: `/health` · `/api/providers` · `/api/calendars` · `/api/events` · `/api/availability` · `/api/conflicts` · `/api/book` · `PATCH`/`DELETE /api/events/:eventId` · `/api/auth/:provider` + `/callback`.

Event model (normalized): `{ id, provider, calendarId, title, description, location, start, end, allDay, attendees }` — ISO 8601 UTC.

Flow for assistants (see `server/docs/assistant-guide.md`): health → providers → calendars → events window → availability → conflicts → book → patch/delete.

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

## Verification (2026-08-15)
- `npm run lint` — 0/0 both workspaces.
- `npm run build` — passes (client).
- E2E through proxy — book → PATCH reschedule → DELETE all succeeded; `/api/availability` returns slots; data reset to 0 events.

Back to [[AI Calendar]].
