---
title: Changelog — AI Calendar
project: AI Calendar
type: changelog
tags:
  - project/ai-calendar
  - changelog
updated: 2026-08-15
---

# Changelog — AI Calendar

> Dated change history for the project. Newest entries at the bottom (append-only). Every project-touching session adds an entry here (Home rule 4). Absolute dates only.

## 2026-08-15 — Clean slate + usage docs
- **Ask:** *"alright remove all example data and gimme and how to use this as well"*
- Removed all seeded events from `server/data/local-calendar.json` (0 events; `work`/`personal` calendars kept). `src/seed.js` rewritten to reset to an empty state instead of seeding samples.
- Root `README.md` rewritten with a **How to use** section: run the app, use the calendar UI (views, booking, edit/delete, drag & drop, calendar management), let an AI assistant drive it via the API (workflow + curl examples), reset data, and connect real providers. Updated the scripts table to reflect that `seed` now resets.
- Verified live through the Vite proxy: `/api/events` returns `count: 0`, `/api/calendars` returns `work`/`personal`.

## 2026-08-15 — Full UI pass + monorepo merge (the big one)
- **Ask:** *"lets make it full flegue opensource calender for ai assitents to manage and also sprinkle all the basic and advance options and all"* (scope chosen: Full UI)
- Restructured `appointment-calendar` → `ai-calendar/client` and `calendar-interrogation` → `ai-calendar/server`; root workspace `package.json` with `concurrently`; workspace names `@ai-calendar/client` / `@ai-calendar/server`.
- Server: added CORS middleware (`CORS_ORIGIN` env, default `*`); fixed dev script to `--watch-path=./src`.
- Client (full rewrite): views `MonthView`/`WeekView`/`DayView`/`AgendaView`; `Sidebar` (provider select, calendar visibility, cycle-color); `BookingModal` (conflict check + double-book opt-in, edit/delete); `ViewSwitcher`; `Event.jsx` chips/blocks; drag & drop (month: across days; week/day: to time slots, 15-min snap). Libs: `datetime.js`, `api.js`, `colors.js`, `layout.js` (overlap-aware layout). `App.jsx` orchestrates providers, view windows, visibility, and the API lifecycle. `App.css`/`index.css` rewritten (responsive at 900px/640px).
- Deleted obsolete client files (`dateUtils.js`, `storage.js`, `Calendar.jsx`, `AppointmentList.jsx`, `AppointmentModal.jsx`).
- Verified: `npm run lint` 0/0 in both workspaces; `npm run build` passes (client); end-to-end through the proxy — book → PATCH (reschedule) → DELETE all succeeded; orphaned event from an earlier 502 cleaned; `/api/providers` reports `local` ready+active.
- Docs: root `ai-calendar/README.md`, `client/README.md` rewritten; `server/README.md` + `server/docs/assistant-guide.md` carried over.

## Earlier (pre-merge, as `calendar-interrogation`)
- **Ask:** build a calendar to test an interrogation API for AI assistants.
- Built the provider-agnostic interrogation API: `GET /health`, `/api/providers`, `/api/calendars`, `/api/events`, `/api/availability`, `/api/conflicts`, `POST /api/book`, `PATCH`/`DELETE /api/events/:eventId`, OAuth auth routes (`/api/auth/google`, `/api/auth/outlook` + callbacks). Providers: `local` (file-backed, calendars `work`/`personal`), `google`, `outlook`, `caldav`. Token storage in `server/data/*.json` (dev-grade). `API_KEY` env optionally gates `/api/*`. Docs: `server/docs/assistant-guide.md`.
- Seed script originally created 10 sample events; data file seeded for testing.
