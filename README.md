<div align="center">

# 📅 AI Calendar

**A calendar your AI assistant can manage.**

A full-featured, open-source calendar app — Month / Week / Day / Agenda views,
drag & drop rescheduling, multi-calendar with colors — backed by a
**provider-agnostic interrogation API** that any AI assistant (or human, or
script) can use to read availability, check conflicts, and book appointments
across **Google Calendar, Microsoft 365, CalDAV, and a local file provider**.

```
│ UI (React)  ──►  Interrogation API (Express)  ──►  local | google | outlook | caldav
```

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/Node-%3E%3D20-339933)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Express](https://img.shields.io/badge/Express-5-000000)

</div>

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Quick start](#quick-start)
- [Use the calendar UI](#use-the-calendar-ui)
- [Use the API directly](#use-the-api-directly)
- [Let an AI assistant manage it](#let-an-ai-assistant-manage-it)
- [Connect a real provider](#connect-a-real-provider)
  - [Google Calendar](#google-calendar)
  - [Microsoft 365 / Outlook](#microsoft-365--outlook)
  - [CalDAV](#caldav)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [How availability works](#how-availability-works)
- [Commands](#commands)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Why this exists

Calendars are usually locked inside one vendor's API. If you want an AI
assistant to *actually manage your schedule* — not just chat about it — you need
one stable, well-documented interface that works the same way no matter where
the events live.

AI Calendar is that interface:

- **One normalized event model** across Google, Microsoft 365, CalDAV, and local
  files. A booking created through one provider looks identical to one from
  another.
- **One interrogation workflow** for assistants: *confirm access → list
  calendars → read events → find free slots → verify conflicts → book →
  maintain*. The same steps work for every provider.
- **A real UI on top.** A polished calendar app that humans can use directly,
  and that exercises the same API an assistant would.

---

## Features

### Calendar UI (`client/`)

- **Four views** — Month (42-cell grid), Week (24-hour grid), Day, and Agenda
  (next 14 days), with `‹ Today ›` navigation.
- **Drag & drop rescheduling** — drop an event on another day in Month view, or
  drag it to a specific time slot in Week/Day view (snaps to 15-minute
  increments, duration preserved).
- **Multi-calendar support** — switch providers, toggle calendar visibility,
  and assign each calendar its own color.
- **Conflict-aware booking** — the booking form asks the API whether a slot is
  free before you save, warns you if it isn't, and only double-books when you
  explicitly opt in.
- **Edit / reschedule / delete** any event from its booking modal.
- **Responsive layout** — usable from desktop down to ~640px.
- Preferences (visibility + colors) persist in `localStorage`.

### Interrogation API (`server/`)

- **Normalized events** — `{ id, provider, calendarId, title, description,
  location, start, end, allDay, attendees }` (ISO 8601 UTC).
- **Availability engine** — finds every free slot of a requested duration inside
  a window, with configurable slot granularity.
- **Server-side conflict detection** — `POST /api/conflicts` is authoritative,
  so assistants and the UI can't disagree.
- **Provider registry** — `local`, `google`, `outlook`, `caldav` implement one
  contract; adding a new provider means implementing five methods.
- **Consistent errors** — every failure returns
  `{ "error": { "code", "message" } }`.
- **Optional API key** — protect `/api/*` with a shared key when exposed.

---

## Quick start

> Requires **Node.js 20+**.

```bash
# 1. Clone
git clone https://github.com/damanjz/ai-calendar.git
cd ai-calendar

# 2. Install
npm install

# 3. Run the API (localhost:3000) and the UI (localhost:5173) together
npm run dev
```

Open **http://localhost:5173**. The app boots with the built-in `local`
provider — zero configuration, no credentials. Book an event, drag it around,
delete it: it's all persisted to `server/data/local-calendar.json`.

> The `local` provider is an offline sandbox. To use your real calendar, see
> [Connect a real provider](#connect-a-real-provider).

---

## Use the calendar UI

| Action | How |
| --- | --- |
| Switch views | `Month` / `Week` / `Day` / `Agenda` buttons in the header |
| Navigate | `‹` / `Today` / `›` |
| Book an event | `+ New booking` → fill title, calendar, start & end (plus optional location, description, attendees) → Save |
| Edit / reschedule | Click the event → edit the form → Save |
| Delete | Click the event → Delete |
| Reschedule by dragging | Month: drag onto another day. Week/Day: drag to a time slot (15-min snap) |
| Show/hide calendars | Sidebar checkboxes |
| Change a calendar's color | Click its color dot in the sidebar |

If the API isn't reachable, a red banner appears with a retry button.

---

## Use the API directly

The API speaks JSON over HTTP. All times are **ISO 8601 with timezone**
(`2026-08-17T09:00:00Z`).

```bash
# Is the API up? Which providers are ready?
curl http://localhost:3000/health

# List the local provider's calendars
curl "http://localhost:3000/api/calendars?provider=local"

# What's booked this week?
curl "http://localhost:3000/api/events?provider=local&from=2026-08-17T00:00:00Z&to=2026-08-24T00:00:00Z"

# Free 30-minute slots tomorrow
curl "http://localhost:3000/api/availability?provider=local&duration=30&from=2026-08-18T00:00:00Z&to=2026-08-19T00:00:00Z"

# Book a slot
curl -X POST http://localhost:3000/api/book \
  -H "Content-Type: application/json" \
  -d '{"provider":"local","calendarId":"work","title":"Team sync","description":"Weekly standup","start":"2026-08-18T09:00:00Z","end":"2026-08-18T09:30:00Z"}'

# Reschedule it
curl -X PATCH "http://localhost:3000/api/events/<eventId>?provider=local" \
  -H "Content-Type: application/json" \
  -d '{"title":"Team sync","start":"2026-08-18T10:00:00Z","end":"2026-08-18T10:30:00Z"}'

# Delete it
curl -X DELETE "http://localhost:3000/api/events/<eventId>?provider=local"

# Check whether a proposed time conflicts
curl -X POST http://localhost:3000/api/conflicts \
  -H "Content-Type: application/json" \
  -d '{"provider":"local","start":"2026-08-18T09:00:00Z","end":"2026-08-18T09:30:00Z"}'
```

For the full request/response contract, see the [API reference](#api-reference).

---

## Let an AI assistant manage it

AI Calendar is designed to be driven by an assistant. Give it this one workflow
and it can manage your schedule end to end:

1. `GET /health` — confirm access and which providers are **ready**.
2. `GET /api/calendars?provider=...` — pick a calendar (or the `primary` one).
3. `GET /api/events?...` — read what's already booked in the window.
4. `GET /api/availability?duration=30` — find slots that fit the request.
5. `POST /api/conflicts` — verify a proposed time.
6. `POST /api/book` — book it.
7. `PATCH` / `DELETE /api/events/:id` — reschedule or cancel.

A complete field manual for assistants lives at
[`server/docs/assistant-guide.md`](server/docs/assistant-guide.md) — including
conventions (UTC conversion, when to ask for an API key), error translation, and
rules of thumb (verify before you assert, confirm intent before booking).

> **Tip:** the UI's own origin (`http://localhost:5173`) proxies `/api` and
> `/health` to the server, so an assistant can talk to one base URL.

---

## Connect a real provider

Copy the template and fill it in:

```bash
cp server/.env.example server/.env
```

Then set `PROVIDERS` to the providers you want active. Each provider also needs
its own credentials:

### Google Calendar

1. Create credentials at [Google Cloud Console](https://console.cloud.google.com/)
   (OAuth 2.0 Client ID, application type **Web application**).
2. Add `http://localhost:3000/api/auth/google/callback` as an authorized
   redirect URI.
3. Set in `server/.env`:
   ```env
   PROVIDERS=local,google
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
4. Open `http://localhost:3000/api/auth/google` in a browser, complete the
   consent flow, and the server stores the token for you.

### Microsoft 365 / Outlook

1. Register an app in [Azure Portal](https://portal.azure.com/) (single-tenant
   or "common"), with a **Web** platform redirect to
   `http://localhost:3000/api/auth/outlook/callback`.
2. Grant the `Calendars.ReadWrite` (and `User.Read`) delegated permissions.
3. Set in `server/.env`:
   ```env
   PROVIDERS=local,outlook
   OUTLOOK_ENABLED=true
   OUTLOOK_CLIENT_ID=...
   OUTLOOK_CLIENT_SECRET=...
   ```
4. Visit `http://localhost:3000/api/auth/outlook` to authenticate once.

### CalDAV

Works with Apple iCloud, Nextcloud, Baikal, Radicale, and other CalDAV servers:

```env
PROVIDERS=local,caldav
CALDAV_ENABLED=true
CALDAV_URL=https://your-server.example.com/remote.php/dav/calendars/me/personal/
CALDAV_USERNAME=...
CALDAV_PASSWORD=...
```

After configuring, pick the provider in the UI sidebar (or target it directly in
the API) and it will show up as `ready` in `/health`.

> **Note:** OAuth tokens are stored as JSON files under `server/data/`, written
> with owner-only permissions (`0600`) and git-ignored. This is convenient for a
> self-hosted single-user setup but is **not** production-grade multi-user auth.

---

## Security posture

This is a **single-user, self-hosted** tool, and the defaults are chosen to match:

- **Binds to `127.0.0.1`.** Nothing outside the machine can reach the API unless
  you deliberately set `HOST`.
- **CORS defaults to the UI origin** (`http://localhost:5173`), not `*`.
- **`API_KEY` is compared in constant time**, so a wrong key leaks nothing through
  response timing. When unset, `/api/*` is open — which is safe only because of
  the loopback bind.
- **OAuth tokens are written `0600`** under the git-ignored `server/data/`.
- The server **warns loudly at startup** if you bind a non-loopback interface
  without an API key, or combine that with `CORS_ORIGIN=*`.

If you expose this beyond localhost, set `API_KEY` **and** a specific
`CORS_ORIGIN`, and put it behind TLS.

---

## API reference

### Conventions

- **Base URL:** `http://localhost:3000`
- **Auth:** if `API_KEY` is set, send it as `x-api-key` or
  `Authorization: Bearer <key>` on every `/api/*` request.
- **Times:** ISO 8601 with timezone (`2026-08-17T09:00:00Z`).
- **Provider:** one of `local`, `google`, `outlook`, `caldav`.
- **calendarId:** scopes a query to one calendar; for reads, omit it to search
  all of a provider's calendars (the `local` provider requires one when booking).
- **Errors:** `{ "error": { "code": string, "message": string } }` with codes
  `unauthorized`, `bad_request`, `not_found`, `conflict`, `provider_error`,
  `internal`.

### `GET /health`

Server status + provider readiness.

```json
{
  "status": "ok",
  "providers": [
    { "id": "local", "name": "Local (file-based)", "configured": true, "ready": true, "active": true }
  ]
}
```

### `GET /api/providers`

Same provider list as `/health`, without the status field.

### `GET /api/calendars?provider=local`

```json
{
  "provider": "local",
  "calendars": [
    { "id": "work", "name": "Work", "primary": true },
    { "id": "personal", "name": "Personal", "primary": false }
  ]
}
```

### `GET /api/events?provider=local&from=<ISO>&to=<ISO>&calendarId=`

Lists normalized events overlapping `[from, to)`. `from`/`to` default to today →
+7 days.

```json
{
  "provider": "local", "from": "...", "to": "...", "count": 1,
  "events": [
    {
      "id": "c1a8...", "provider": "local", "calendarId": "work",
      "title": "Team sync", "description": "", "location": "",
      "start": "2026-08-18T09:00:00.000Z", "end": "2026-08-18T09:30:00.000Z",
      "allDay": false, "attendees": []
    }
  ]
}
```

### `GET /api/availability?provider=local&from=<ISO>&to=<ISO>&duration=30&granularity=15`

Finds free slots of exactly `duration` minutes, sampled every `granularity`
minutes (default 15). `duration` is required.

```json
{
  "provider": "local", "from": "...", "to": "...", "duration": 30, "count": 84,
  "slots": [
    { "start": "2026-08-18T00:00:00.000Z", "end": "2026-08-18T00:30:00.000Z", "duration": 30, "provider": "local", "calendarId": null }
  ]
}
```

### `POST /api/conflicts`

Checks whether a proposed time overlaps existing events. Provide
`start`+`end`, or `start`+`duration`.

```json
// Request
{ "provider": "local", "start": "2026-08-18T09:00:00Z", "end": "2026-08-18T09:30:00Z" }

// Response
{ "provider": "local", "proposed": { "start": "...", "end": "..." }, "clear": false, "count": 1, "conflicts": [ /* matching events */ ] }
```

### `POST /api/book`

Creates an event. Returns `201`.

```json
// Request
{
  "provider": "local",
  "calendarId": "work",
  "title": "Coffee with Sam",
  "start": "2026-08-18T14:00:00Z",
  "end": "2026-08-18T14:30:00Z",
  "description": "Discuss the proposal",
  "location": "Blue Bottle",
  "attendees": ["sam@example.com"]
}

// Response
{ "booked": true, "event": { "id": "...", ... } }
```

### `PATCH /api/events/:eventId?provider=local&calendarId=`

Updates an event. The body is the full event shape (same fields as `book`).

### `DELETE /api/events/:eventId?provider=local`

```json
{ "deleted": true, "provider": "local" }
```

### `GET /api/auth/:provider` · `GET /api/auth/:provider/callback`

OAuth entry points for `google` / `outlook` providers. The first returns the
authorization URL; the callback exchanges the code and stores the token.
`caldav` and `local` are configured via environment variables and have no OAuth.

---

## Configuration

All configuration is environment-driven (`server/.env`, see
[`.env.example`](server/.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_PORT` | `3000` | API port. Takes precedence over `PORT` |
| `PORT` | `3000` | API port (fallback; `API_PORT` wins) |
| `HOST` | `127.0.0.1` | Interface to bind. Loopback by default |
| `API_KEY` | *(empty)* | When set, required on every `/api/*` request |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `PROVIDERS` | `local` | Comma-separated active providers |
| `GOOGLE_ENABLED` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | — | Google Calendar OAuth |
| `OUTLOOK_ENABLED` / `OUTLOOK_TENANT` / `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` / `OUTLOOK_REDIRECT_URI` | — | Microsoft 365 OAuth |
| `CALDAV_ENABLED` / `CALDAV_URL` / `CALDAV_USERNAME` / `CALDAV_PASSWORD` | — | CalDAV server (Basic auth) |
| `DATA_DIR` | `server/data` | Where file-based storage lives |

---

## Project structure

```
ai-calendar/
├── package.json              # npm workspaces: client + server
├── client/                   # @ai-calendar/client — React + Vite UI (port 5173)
│   ├── src/
│   │   ├── App.jsx           # orchestration: providers, views, drag & drop, modal
│   │   ├── components/       # Month/Week/Day/AgendaView, Sidebar, BookingModal, Event, ViewSwitcher
│   │   └── lib/              # api.js, datetime.js, colors.js, layout.js (overlap-aware)
│   └── vite.config.js        # dev proxy: /api, /health → localhost:3000
└── server/                   # @ai-calendar/server — Express interrogation API (port 3000)
    ├── src/
    │   ├── app.js            # builds the Express app (CORS, errors) — no listen()
    │   ├── server.js         # binds the port + startup safety warnings
    │   ├── router.js         # all /api routes
    │   ├── config.js         # env-driven config
    │   ├── seed.js           # reset local calendar to empty
    │   ├── providers/        # base.js (contract) + local, google, outlook, caldav, index.js
    │   ├── auth/             # OAuth token storage (0600 JSON)
    │   └── lib/              # errors, validate, util (availability engine), fs-store
    ├── test/                 # node:test suites (util, validate, providers, HTTP API)
    ├── docs/assistant-guide.md  # field manual for AI assistants
    └── data/                 # git-ignored runtime data (local-calendar.json, OAuth tokens)
```

`app.js` is split from `server.js` so tests can drive the real app over an
ephemeral port without starting the production listener.

---

## Tests

```bash
npm test              # run everything
npm run test:coverage # with a coverage report
```

The suite uses Node's built-in `node:test` — **no test-framework dependency**.
It covers the availability engine's edge cases (enclosed, touching, zero-length
and DST-crossing intervals), request validation, the local provider's full CRUD
lifecycle, the Google/Outlook/CalDAV adapters against a stubbed transport, and
the HTTP layer end to end (auth, CORS, error envelope, book → conflict → delete).

One property is asserted directly, because the whole product rests on it:
**every slot `availability` offers must be reported clear by `conflicts`.**

---

## How availability works

`GET /api/availability` is powered by a small scheduling engine
(`server/src/lib/util.js`):

1. Loads all events in `[from, to)` for the requested calendar.
2. Trims each event to the window and sorts them.
3. Walks the window in `granularity`-minute steps (default 15), emitting a slot
   whenever a full `duration`-minute block collides with no event.

The same overlap logic (`intervalsOverlap`) powers `POST /api/conflicts`, so
availability and conflict checks can never disagree.

---

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API (:3000) and UI (:5173) together |
| `npm test` | Run the server test suite (`node:test`, no extra dependencies) |
| `npm run test:coverage` | Run the tests with a coverage report |
| `npm run build` | Build the client for production (outputs `client/dist/`) |
| `npm run lint` | Lint both workspaces (oxlint) |
| `npm run seed` | Reset the local calendar to an empty state |
| `npm run start` | Run only the server (production) |

---

## Roadmap

- [ ] Recurring events (RRULE)
- [ ] Timezones & working hours
- [ ] Reminders, categories, and search
- [ ] ICS import/export
- [ ] Docker image
- [ ] Refresh-token rotation for long-running assistants

---

## Contributing

Contributions are welcome! This is a small, deliberately simple codebase.

- **Bugs & features:** open an issue with a clear repro.
- **New providers:** implement the five methods in
  `server/src/providers/base.js` and register it in `server/src/providers/index.js`.
- **Code style:** keep it clean and dependency-light. Run `npm run lint` and
  `npm run build` before submitting.

---

## License

[MIT](LICENSE) © 2026 Apuri Daman Reddy
