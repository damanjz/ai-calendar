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
- Full UI pass shipped in the repo: Month/Week/Day/Agenda views, drag & drop rescheduling, sidebar multi-calendar + colors, conflict-checked booking modal with edit/delete.
- Provider-agnostic interrogation API: providers behind one contract (`local`/`google`/`outlook`/`caldav`); only `local` is ready+active (no credentials configured yet).
- Verified end-to-end through the Vite proxy: book → PATCH (reschedule) → delete all succeeded; `/api/availability` returns free slots; lint clean both workspaces; `npm run build` passes.

## In progress
- None — build phase complete.

## Next / backlog
- **Git:** 0 commits at `C:\Demon Projects`; `ai-calendar/` untracked. Commit + push only on Daman's word (standing git rule). Open question: publish public on GitHub (it's meant to be open-source).
- **Deferred feature groups** (Daman's scoping pick 2026-08-15, only "Full UI" chosen): recurring events (RRULE) · timezones & working hours · reminders/categories/search · ICS import/export.
- **Live providers:** wire Google/Outlook OAuth + CalDAV creds via `server/.env` (tokens land as JSON in `server/data/`).

## Known issues / risks
- OAuth tokens stored as plain JSON in `server/data/` — dev-grade only.
- Sole copy of work is the working tree (no remote).
- Only the `local` provider is exercised in testing; live-provider paths are untested against real accounts.

## Links
- [[AI Calendar]] · [[Decisions]] · [[Changelog]]
