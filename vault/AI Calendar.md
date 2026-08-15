---
title: AI Calendar
project: AI Calendar
type: index
tags:
  - project/ai-calendar
  - open-source
  - calendar
  - react
  - express
repo: https://github.com/damanjz/ai-calendar (public, MIT)
local: G:\Claude Projects\ai-calendar
status: published; hardened (118 tests, 90.7% coverage); recurring events expanded across all providers
created: 2026-08-15
updated: 2026-08-15
---

# AI Calendar

> **Index note** — the short, always-read overview. Detail lives in the linked notes; open those only when a task needs them.

> [!note] What this is
> Open-source calendar app that **AI assistants can manage**. Two halves in one monorepo: a **React + Vite UI** (Month/Week/Day/Agenda views, drag & drop rescheduling, multi-calendar with colors, conflict-checked booking) and a **provider-agnostic REST API** (the "interrogation" layer) so assistants read, book, reschedule, and delete events across Google Calendar, Outlook/Microsoft Graph, CalDAV, and a local file provider. Merged 2026-08-15 from two earlier workspaces: `appointment-calendar` (UI) + `calendar-interrogation` (API) → `ai-calendar`.

- **Repo / Local:** https://github.com/damanjz/ai-calendar (public, MIT) · `G:\Claude Projects\ai-calendar`
- **Latest:** PR #1 merged into `master` (2026-08-15) — hardening pass + recurring events. **118 tests, 90.7% line coverage**, lint clean, builds.

> [!warning] Binding rules
> Standing git rule from [[Daman — Taste & Preferences]]: **don't commit/push without Daman's word.** OAuth tokens live in `server/data/` as JSON — now written `0600`, but still dev-grade single-user storage, never production-safe. Only the `local` provider is active by default, and **no remote provider has ever run against a real account**.

## What it is
An appointment calendar whose booking surface is a clean REST API first (providers registered behind one contract) and a polished web UI second — so both a human and an AI assistant can drive the same calendars. Normalized event model across providers: `{ id, provider, calendarId, title, description, location, start, end, allDay, attendees }` (ISO 8601 UTC).

**Recurring events are returned expanded** — one concrete instance per occurrence, carrying `recurringEventId` + `originalStart`. Never a master with a rule attached.

## Current status
- Built: full UI pass (Month/Week/Day/Agenda, drag & drop, sidebar multi-calendar + colors, booking modal with server-side conflict check + explicit double-book opt-in).
- **Published:** public on GitHub, MIT. `master` = PR #1 merged (9 commits).
- **Tested:** 118 tests / 90.7% line coverage via `node:test` (no test-framework dependency). `npm test`.
- **Hardened:** constant-time API key, loopback bind by default, CORS scoped to the UI origin, OAuth tokens `0600`.
- Clean: example/seed data removed; `npm run seed` resets the local calendar to an empty state.

> [!important] Two real bugs found and fixed on 2026-08-15
> - **The Google provider crashed on every call.** `calendar()` was `async`, so `await this.calendar().events.list()` read `.events` off a pending Promise. All five call sites — the provider was dead on arrival.
> - **Recurring events were never expanded**, so a series starting before the requested window was invisible and *all* its occurrences read as free. A weekly standup begun in 2030 returned 0 events for June 2031.

## Project notes
- [[Status]] — current state, in progress, next steps
- [[Decisions]] — design decisions, dates + rationale
- [[Changelog]] — dated change history
- [[Where things live (AI Calendar)]] — file map: every artifact's exact path (mandatory — Home rule 10)
- [[Architecture]] — how it's built

## Quick facts
- **Stack:** client = React + Vite (`@ai-calendar/client`); server = Node/Express (`@ai-calendar/server`); npm workspaces; `concurrently` for dev. Runtime deps: `express`, `googleapis`, `node-ical`, `rrule`.
- **Ports:** API 3000 · UI 5173 (Vite proxy: `/api` + `/health` → API). ⚠ Use **`API_PORT`**, not `PORT` — `PORT` is injected by some launchers to mean "the port for this app", which made the API steal the UI's port.
- **Tests:** `npm test` (118) · `npm run test:coverage` (90.7%). Built-in `node:test`, zero test deps.
- **Providers:** `local` (file-based, active), `google`, `outlook`, `caldav` (need `server/.env` creds + OAuth).
- **Key endpoints:** `/health` · `/api/providers` · `/api/calendars` · `/api/events` · `/api/availability` · `/api/conflicts` · `/api/book` · `PATCH`/`DELETE /api/events/:eventId` · `/api/auth/:provider` + `/callback`.
- **UI prefs:** `ai-calendar.prefs.v1` in localStorage (calendar visibility + colors).

## Links
- [[Home]] · [[Project Dashboard]] · [[Context Map]]
