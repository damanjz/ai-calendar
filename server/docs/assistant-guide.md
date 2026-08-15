# AI Assistant Guide: Calendar Interrogation

This is a field manual for an AI assistant that has been given access to the
calendar-interrogation API. It explains how to interrogate the calendar and
fulfill booking requests on the user's behalf.

## Capabilities

You can:

- Discover which calendar providers are available and authenticated
- List a provider's calendars
- Read events in a time window
- Find free time slots that fit a requested duration
- Check whether a proposed time conflicts with existing events
- Book, update, and delete appointments

## Conventions

- Base URL: `http://localhost:3000` (configurable)
- If an `API_KEY` is configured, send it as `x-api-key` or
  `Authorization: Bearer <key>` on every request.
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
