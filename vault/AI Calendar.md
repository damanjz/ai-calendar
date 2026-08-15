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
repo: none yet — git repo at C:\Demon Projects (0 commits; ai-calendar/ untracked)
local: C:\Demon Projects\ai-calendar
status: full UI + interrogation API built and E2E-verified locally; clean data; not committed/published
created: 2026-08-15
updated: 2026-08-15
---

# AI Calendar

> **Index note** — the short, always-read overview. Detail lives in the linked notes; open those only when a task needs them.

> [!note] What this is
> Open-source calendar app that **AI assistants can manage**. Two halves in one monorepo: a **React + Vite UI** (Month/Week/Day/Agenda views, drag & drop rescheduling, multi-calendar with colors, conflict-checked booking) and a **provider-agnostic REST API** (the "interrogation" layer) so assistants read, book, reschedule, and delete events across Google Calendar, Outlook/Microsoft Graph, CalDAV, and a local file provider. Merged 2026-08-15 from two earlier workspaces: `appointment-calendar` (UI) + `calendar-interrogation` (API) → `ai-calendar`.

- **Repo / Local:** none yet (git repo at `C:\Demon Projects`, 0 commits) · `C:\Demon Projects\ai-calendar`
- **Latest:** full UI pass, E2E-verified end-to-end; example data removed, `seed` now resets to empty (2026-08-15)

> [!warning] Binding rules
> Standing git rule from [[Daman — Taste & Preferences]]: **don't commit/push without Daman's word** (repo currently 0 commits, `ai-calendar/` untracked). OAuth tokens are plain-JSON dev storage in `server/data/` — dev-grade only, never treat as production-safe. Only the `local` provider is active by default.

## What it is
An appointment calendar whose booking surface is a clean REST API first (providers registered behind one contract) and a polished web UI second — so both a human and an AI assistant can drive the same calendars. Normalized event model across providers: `{ id, provider, calendarId, title, description, location, start, end, allDay, attendees }` (ISO 8601 UTC).

## Current status
- Built: full UI pass (Month/Week/Day/Agenda, drag & drop, sidebar multi-calendar + colors, booking modal with server-side conflict check + explicit double-book opt-in).
- Verified: lint clean in both workspaces, production build passes, end-to-end lifecycle through the Vite proxy (book → PATCH reschedule → delete) confirmed.
- Clean: example/seed data removed; `npm run seed` resets the local calendar to an empty state.
- Not shipped: 0 commits, no remote, sole copy is the working tree at `C:\Demon Projects\ai-calendar`.

## Project notes
- [[Status]] — current state, in progress, next steps
- [[Decisions]] — design decisions, dates + rationale
- [[Changelog]] — dated change history
- [[Where things live (AI Calendar)]] — file map: every artifact's exact path (mandatory — Home rule 10)
- [[Architecture]] — how it's built

## Quick facts
- **Stack:** client = React + Vite (`@ai-calendar/client`); server = Node/Express (`@ai-calendar/server`); npm workspaces; `concurrently` for dev.
- **Ports:** API 3000 · UI 5173 (Vite proxy: `/api` + `/health` → `http://localhost:3000`).
- **Providers:** `local` (file-based, active), `google`, `outlook`, `caldav` (need `server/.env` creds + OAuth).
- **Key endpoints:** `/health` · `/api/providers` · `/api/calendars` · `/api/events` · `/api/availability` · `/api/conflicts` · `/api/book` · `PATCH`/`DELETE /api/events/:eventId` · `/api/auth/:provider` + `/callback`.
- **UI prefs:** `ai-calendar.prefs.v1` in localStorage (calendar visibility + colors).

## Links
- [[Home]] · [[Project Dashboard]] · [[Context Map]]
