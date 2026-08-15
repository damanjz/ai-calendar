---
title: AI Calendar — Status
project: AI Calendar
type: status
tags:
  - project/ai-calendar
  - status
updated: 2026-08-15
---

# AI Calendar — Status

> Current state and what's next. Keep this short; move finished items to [[Changelog]].

## Now
- **Published:** https://github.com/damanjz/ai-calendar (public, MIT). `master` = PR #1 merged 2026-08-15.
- Full UI pass: Month/Week/Day/Agenda views, drag & drop rescheduling, sidebar multi-calendar + colors, conflict-checked booking modal with edit/delete.
- Provider-agnostic interrogation API: providers behind one contract (`local`/`google`/`outlook`/`caldav`); only `local` is ready+active (no credentials configured yet).
- **118 tests / 90.7% line coverage** (`node:test`, no test-framework dependency). Lint clean; `npm run build` passes.
- **Recurring events expand** to one instance per occurrence across all four providers.

## In progress
- None.

## Next / backlog
- **Live providers:** wire Google/Outlook OAuth + CalDAV creds via `server/.env` and exercise them for real. This is the top item — see risks below.
- **Timezones & working hours** — availability still offers 03:00 slots.
- **Series-scoped edit/delete** — "this occurrence / this and following / all events".
- **Recurrence UI** — a rule can only be set via the API today; no control in the booking modal.
- Persist `recurrence` on write for remote providers (`toGoogleEvent`/`toGraphEvent`/`toIcs` emit no rule, so *creating* a recurring event only works on `local`).
- `distinct=true` option on availability so slots don't overlap each other (08:00, 08:15, 08:30 for 30-min slots) — today "give me the first 3 slots" returns three near-identical times.
- Client-side series handling: drag-and-drop resolves by `id`, which is now an *instance* id. Dragging an occurrence PATCHes that instance — correct-ish, but untested and unexplained in the UI.
- Split `client/src/App.jsx` (322 lines: providers + views + drag/drop + modal orchestration) if it grows further. Under the 800-line ceiling, not urgent.
- Add a repo `CHANGELOG.md` mirroring `vault/Changelog.md`.
- Still deferred from the original scoping pick: reminders/categories/search · ICS import/export · Docker image · refresh-token rotation for long-running assistants.

## Known issues / risks
- ⚠ **No remote provider has ever run against a real account.** Google/Outlook/CalDAV pass against *stubbed transports*, which verifies our logic and request shapes — not the live APIs. Highest-risk single change: the Outlook switch from `/me/events` to `/me/calendarView`, reasoned from Graph's documented behaviour and never executed.
- **No series-scoped edit/delete.** `PATCH`/`DELETE` act on one id and the blast radius differs by provider — Google cancels one occurrence, CalDAV deletes the whole `.ics`. The assistant guide instructs the assistant to ask first; the API does not enforce it.
- OAuth tokens in `server/data/` are `0600` JSON — still dev-grade single-user storage, not production multi-user auth.
- No timezone or working-hours handling; availability treats 03:00 as bookable.
- Availability slots overlap each other (08:00, 08:15, 08:30 for 30-min slots) — intentional and documented, but "the first 3 slots" returns three near-identical times.
- 5 moderate `npm audit` findings, all **pre-existing** transitive `uuid` via `node-ical`/`googleapis`. Fixing needs a breaking `node-ical` major.

## Links
- [[AI Calendar]] · [[Decisions]] · [[Changelog]]
