# AI Assistant Guide: Calendar Interrogation

This is a field manual for an AI assistant that has been given access to the
calendar-interrogation API. It explains how to interrogate the calendar and
fulfill booking requests on the user's behalf.

## Capabilities

You can:

- Discover which calendar providers are available and authenticated
- List a provider's calendars
- Read events in a time window (with optional text search)
- Find free time slots that fit a requested duration (optionally restricted to
  working hours in a timezone)
- Check whether a proposed time conflicts with existing events
- Book, update, and delete appointments (including single-occurrence / rest-of-
  series / whole-series scope for recurring events)
- List upcoming reminders and import/export `.ics` files

## Conventions

- Base URL: `http://localhost:3000` (configurable via `API_PORT`). The server
  binds loopback only by default, so it is reachable from the same machine.
- If an `API_KEY` is configured, send it as `x-api-key` or
  `Authorization: Bearer <key>` on every request. `/health` never requires it,
  so you can always check liveness first.
- All times are **ISO 8601 with timezone** (e.g. `2026-08-17T09:00:00Z`).
  Always convert the user's local time to UTC before calling the API, and
  convert results back when reporting to the user.
- A **provider** is one of `local`, `google`, `outlook`, `caldav`. Use the
  `local` provider for offline testing.
- A **calendarId** scopes a query to a specific calendar. Omit it to use the
  provider default (primary calendar).
- Ask for the API key only if a request fails with `unauthorized`.

## The interrogation workflow

Follow these steps in order. Stop at any step if you cannot proceed and tell
the user what is missing.

### 1. Confirm access

```
GET /health
```
Check that `status` is `ok`. Note which providers report `"ready": true`.
If none are ready, tell the user to complete OAuth (see README) before you can
manage their calendar.

### 2. Pick a provider and calendar

```
GET /api/providers
GET /api/calendars?provider=google
```
If the user has multiple calendars, ask which one to use (or pick the
`"primary": true` one and say so).

### 3. Read what's already booked

```
GET /api/events?provider=google&from=2026-08-17T00:00:00Z&to=2026-08-24T00:00:00Z
```
Use this to ground every answer in reality. Never claim a time is free without
checking availability.

### 4. Find free slots for a request

When the user asks "can you book X for Y minutes", call:

```
GET /api/availability?provider=google&from=<window start>&to=<window end>&duration=30
```

- `duration` is in **minutes** and is required.
- The response is `{ slots: [{ start, end, duration, provider, calendarId }] }`.
- If the user gives constraints ("this week", "after 5pm", "anytime Tuesday"),
  map them to `from`/`to` before calling.

Working hours and timezone can narrow the results server-side:
- `workDays=1-5` — which weekdays count (0=Sunday..6=Saturday, ranges allowed).
- `workStart=09:00` / `workEnd=17:00` — the local wall-clock window; a slot is
  only free when it fits entirely inside.
- `timeZone=America/New_York` — an IANA zone the window is interpreted in
  (defaults to UTC). Use the user's local zone so "working hours" means *their*
  9-to-5, not UTC's.

Recommend the earliest slot that fits the user's constraints. Present 2–3
options rather than overwhelming the user with every slot.

### 5. Double-check a proposed time

Before booking, verify with:

```
POST /api/conflicts
Content-Type: application/json

{
  "provider": "google",
  "start": "2026-08-17T14:00:00Z",
  "end": "2026-08-17T14:30:00Z"
}
```
`"clear": true` means no conflicts. If `false`, report the conflicting event
titles and propose an alternative.

### 6. Book it

```
POST /api/book
Content-Type: application/json

{
  "provider": "google",
  "title": "Coffee with Sam",
  "start": "2026-08-17T14:00:00Z",
  "end": "2026-08-17T14:30:00Z",
  "description": "Discuss the proposal",
  "location": "Blue Bottle",
  "attendees": ["sam@example.com"]
}
```
Confirm to the user with the event id, title, and the local-time version of the
slot. Never say "booked" unless the API returned `"booked": true`.

### 7. Maintain the calendar

- **Reschedule / edit:** `PATCH /api/events/:eventId?provider=google` with the
  full event body. Preserve `title` and attendees unless the user asks to change them.
- **Cancel:** `DELETE /api/events/:eventId?provider=google`. Confirm with the user
  before deleting; report the result.
- For events that are part of a repeating series (they carry `recurringEventId`),
  add a `scope` query parameter to say how far the change reaches — see
  "Recurring events" below.

## Recurring events

Recurring events are returned **already expanded**: one entry per occurrence in
the window you asked for, never a single "master" carrying a repeat rule. So you
can treat every event you read as a concrete block of time and do no recurrence
maths yourself.

An occurrence carries two extra fields:

- `recurringEventId` — the id of the series it belongs to
- `originalStart` — that occurrence's own start time

Its `id` is unique per occurrence (`<seriesId>_<timestamp>`), so occurrences can
be told apart.

**When booking**, you may pass a `recurrence` rule to create a repeating event:

```json
{
  "provider": "local",
  "title": "Weekly standup",
  "start": "2031-09-01T09:00:00Z",
  "end": "2031-09-01T09:30:00Z",
  "recurrence": "RRULE:FREQ=WEEKLY;COUNT=10"
}
```

An invalid rule is rejected with `bad_request`, so a malformed rule never
silently produces a one-off event.

**Editing or deleting a recurring event** is controlled by `scope` on `PATCH` /
`DELETE /api/events/:eventId`:

- `scope=this` (default) — changes just the occurrence whose id you pass
  (`<seriesId>_<timestamp>`). The rest of the series is untouched.
- `scope=following` — changes that occurrence and every later one. The local
  provider splits the series at that point into a new series, so earlier
  occurrences keep their old properties and later ones take the new ones.
- `scope=all` — changes the whole series; pass the **series** id
  (`recurringEventId`), not an occurrence id.

**Always ask the user which scope they want** before editing or cancelling
anything that carries a `recurringEventId`: "just this one, this and all
following, or the whole series?" Never guess.

Provider support for `scope`: `local` implements all three; Google and Outlook
support `this` and `all` natively (their ids are real API ids); CalDAV supports
only `all` (it rewrites the whole `.ics` resource). Unsupported scopes are
rejected with `bad_request`, and `scope=following` on a bare series id is
rejected too — it needs an occurrence id to know where to split.

## Search, reminders, and categories

- **Search:** add `&q=<text>` to `GET /api/events`. It filters by title,
  description, location, and category (case-insensitive substring). Use it when
  the user says "find the dentist appointment" or "when did I meet Sam?".
- **Categories:** events may carry `category` (a short free-form label like
  `team` or `health`). Preserve it on edits; filter with `?q=`.
- **Reminders:** events may carry `reminders`, an array of minutes-before-start
  offsets (e.g. `[15, 60]`). To answer "what do I have coming up soon?", call
  `GET /api/reminders?provider=google&from=<now>&to=<+24h>`. Each listed event
  has `reminders` as concrete ISO trigger times. Recurring events contribute
  one trigger per occurrence. When the user says "remind me 30 minutes before",
  pass `"reminders": [30]` on `POST /api/book`.

## Import and export

- **Export:** `GET /api/export/ics?provider=local&calendarId=` returns the
  calendar as an `.ics` document you can hand the user for Google/Apple/Outlook
  import. Series masters carry their `RRULE`.
- **Import:** `POST /api/import/ics` with body
  `{ "provider": "local", "calendarId": "work", "ics": "<document text>" }`
  creates every VEVENT (an RRULE becomes a series master). Use it when the user
  has an `.ics` file from another service and wants it in their calendar. The
  response reports `imported` count and any skipped components in `errors`.

## Error handling

Errors come back as `{ "error": { "code", "message" } }`. Translate these for
the user:

| code | Meaning / what to say |
| --- | --- |
| `unauthorized` | Missing/wrong API key, or OAuth not completed. |
| `bad_request` | One of the parameters was invalid. Re-read the API docs. |
| `not_found` | The event or calendar doesn't exist. |
| `conflict` | The time overlaps something. Offer alternatives. |
| `provider_error` | The upstream provider failed. Retry once, then report. |

## Rules of thumb

- Verify before you assert: check availability, then check conflicts, then book.
- Always confirm the user's intent before booking or deleting.
- Prefer the earliest slot that fits, but respect stated constraints.
- Keep the response concise; you are an assistant, not an API dump.
