# Calendar Interrogation

A provider-agnostic JSON API that lets any AI assistant "interrogate" calendar
providers — querying availability, finding conflicts, and booking appointments —
through one consistent interface.

Supported providers:

| Provider | Auth | Endpoint |
| --- | --- | --- |
| `local` | none (file-based, for dev/testing) | built-in |
| `google` | OAuth 2.0 (Google Calendar API) | `/api/auth/google` |
| `outlook` | OAuth 2.0 (Microsoft Graph) | `/api/auth/outlook` |
| `caldav` | Basic auth (Apple, Nextcloud, Baikal, …) | via env |

## Quick start

```bash
npm install
npm run seed        # populate the local calendar with sample events
npm run dev         # http://localhost:3000
```

Try it:

```bash
# What providers are available?
curl http://localhost:3000/api/providers

# Free 30-minute slots in the next 3 days on the work calendar
curl "http://localhost:3000/api/availability?provider=local&calendarId=work&from=2026-08-15T00:00:00Z&to=2026-08-18T00:00:00Z&duration=30"

# Book an appointment
curl -X POST http://localhost:3000/api/book \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "local",
    "calendarId": "work",
    "title": "Standup",
    "start": "2026-08-17T09:00:00Z",
    "end": "2026-08-17T09:30:00Z"
  }'
```

## Configuration

Copy `.env.example` to `.env` and fill in credentials. The server reads
environment variables at startup.

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (default `3000`) |
| `API_KEY` | Optional shared key; send as `x-api-key` or `Authorization: Bearer` |
| `PROVIDERS` | Comma-separated active providers (default `local`) |
| `DATA_DIR` | Where local data and OAuth tokens are stored (default `./data`) |

### Google Calendar

1. Create OAuth credentials (Web application) at
   https://console.cloud.google.com/apis/credentials
2. Add `http://localhost:3000/api/auth/google/callback` as an authorized
   redirect URI.
3. Enable the **Google Calendar API**.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ENABLED=true`.
5. Start the flow: open `GET /api/auth/google`, visit the returned URL, consent,
   then close the tab.

### Microsoft 365 / Outlook

1. Register an app at https://entra.microsoft.com (App registrations).
2. Add `http://localhost:3000/api/auth/outlook/callback` as a Web redirect URI.
3. Grant `Calendars.ReadWrite` and `offline_access` permissions.
4. Set `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_ENABLED=true`.
5. Start the flow: open `GET /api/auth/outlook`.

### CalDAV

No OAuth needed. Point `CALDAV_URL` at one or more calendar collection URLs and
provide `CALDAV_USERNAME` / `CALDAV_PASSWORD` (the URL may be
comma-separated). The calendar id used in API calls is the collection URL.

## API reference

All responses are JSON. Errors use the shape
`{ "error": { "code", "message" } }`.

### `GET /health`
Health check plus provider status.

### `GET /api/providers`
List providers with `configured`, `ready`, and `active` flags.

### `GET /api/calendars?provider=google`
List calendars the account can read.

### `GET /api/events?provider=local&calendarId=work&from=<ISO>&to=<ISO>`
Events within a window (defaults: today → +7 days).

### `GET /api/availability?provider=&calendarId=&from=&to=&duration=30&granularity=15`
Free slots. `duration` (minutes) is required; `granularity` defaults to 15.
Each slot is `{ start, end, duration, provider, calendarId }`.

### `POST /api/conflicts`
```json
{
  "provider": "local",
  "calendarId": "work",
  "start": "2026-08-17T09:00:00Z",
  "duration": 60
}
```
Returns `{ clear: bool, conflicts: [...] }`. Provide `end` instead of
`duration` if you prefer.

### `POST /api/book`
```json
{
  "provider": "local",
  "calendarId": "work",
  "title": "Standup",
  "start": "2026-08-17T09:00:00Z",
  "end": "2026-08-17T09:30:00Z",
  "description": "optional",
  "location": "optional",
  "attendees": ["a@example.com"]
}
```
Creates the event and returns the normalized event with its provider id.

### `PATCH /api/events/:eventId?provider=local&calendarId=work`
Update an existing event. Body is the same shape as `/api/book`.

### `DELETE /api/events/:eventId?provider=local&calendarId=work`
Delete an event.

## Normalized event model

Every provider's events are mapped to:

```json
{
  "id": "provider-specific id",
  "provider": "google",
  "calendarId": "primary",
  "title": "Standup",
  "description": "",
  "location": "",
  "start": "2026-08-17T09:00:00Z",
  "end": "2026-08-17T09:30:00Z",
  "allDay": false,
  "attendees": ["a@example.com"]
}
```

## Security notes

- OAuth tokens are stored in plain JSON under `DATA_DIR` (default `./data`).
  Use a proper secret store in production.
- Set `API_KEY` and always serve behind HTTPS in production.
- The API key protects `/api/*`; the OAuth callback is intentionally open so
  the browser redirect works.

## Workspace layout

```
src/
  server.js          # Express app entry
  config.js          # environment config
  router.js          # all API routes
  seed.js            # seeds the local provider
  lib/               # errors, overlap/availability math, validation, file store
  auth/store.js      # token persistence
  providers/         # provider implementations
    base.js          # provider contract + default availability logic
    local.js google.js outlook.js caldav.js
    index.js         # registry
```

## Adding a provider

Implement `src/providers/base.js` (extend `CalendarProvider`): `getCalendars`,
`getEvents`, `createEvent`, `updateEvent`, `deleteEvent`, plus `isConfigured` /
`isReady`. Register it in `src/providers/index.js` and add its env vars to
`src/config.js`. The availability and conflict endpoints work automatically via
the base class.
