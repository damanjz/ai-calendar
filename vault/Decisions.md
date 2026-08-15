---
title: AI Calendar — Decisions
project: AI Calendar
type: decisions
tags:
  - project/ai-calendar
  - decisions
updated: 2026-08-15
---

# AI Calendar — Decisions

> Append-only log of significant decisions. Newest first. Each entry: date, decision, why.

## 2026-08-15 — Merge the two earlier workspaces into one monorepo
`appointment-calendar` (React UI) + `calendar-interrogation` (provider-agnostic API) merged into **`ai-calendar/`** as npm workspaces (`client/` + `server/`), one root `npm run dev` via `concurrently`.
**Why:** a single open-source product — one install, one run, one README — with the interrogation API and the full UI sharing one repo, instead of two parallel codebases.

## 2026-08-15 — Scope: "Full UI" pass only
From the offered feature groups, Daman picked **Full UI**: Month/Week/Day/Agenda views, drag & drop rescheduling, multi-calendar with colors. Deferred: recurring (RRULE), timezones/working hours, reminders/categories/search, ICS import/export.
**Why:** Daman's explicit scoping choice; ship a cohesive, verified core before stacking features.

## 2026-08-15 — Server dev script watches `src` only
`node --watch src/server.js` → `node --watch-path=./src src/server.js`.
**Why:** plain `--watch` watched `node_modules` (Vite cache churn) and restarted mid-request, causing ECONNREFUSED/502s.

## 2026-08-15 — Conflict checking lives server-side, with opt-in double-book
`POST /api/conflicts` evaluates overlap server-side; the booking modal warns and requires an explicit **"Book anyway (double-book)"** checkbox to proceed.
**Why:** authoritative conflict logic in the API (usable by AI assistants too), not just a client-side nicety; no silent double-booking.

## 2026-08-15 — UI persistence in localStorage
`ai-calendar.prefs.v1` stores per-calendar visibility + colors.
**Why:** instant, zero-server persistence for pure-UI preferences; colors are per-provider-calendar, not global.

## 2026-08-15 — Example data removed; `seed` resets to empty
Cleared all seeded events from `server/data/local-calendar.json`; `src/seed.js` now writes an empty calendar set.
**Why:** Daman asked for a clean start ("remove all example data") — a real install should not ship with fake bookings.

## Earlier (2026-08-15 merge notes)
- **Provider-agnostic API first** — a calendar app whose primary interface is an interrogation API for AI assistants (originated as `calendar-interrogation`).
- **Provider contract** — a normalized event model + registry (`local`/`google`/`outlook`/`caldav`), so assistants talk one API regardless of backend.
- **Build tooling** — React + Vite client; Node/Express server; `concurrently` for dev.

## Links
- [[AI Calendar]] · [[Status]] · [[Changelog]]
