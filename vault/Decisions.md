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

## 2026-08-15 — Recurrence expanded per-provider, not in a shared wrapper
Each provider's `getEvents` returns series already expanded, rather than wrapping a shared expander around the call sites.
**Why:** `getEvents` has **three** call sites (`base.js` for availability, `router.js` twice for the raw read and conflicts). A wrapper would need applying at all three, and any future call site would silently bypass it — reintroducing the exact bug. Per-provider also lets Google and Outlook use their upstream's own expansion (`singleEvents` / `calendarView`) instead of re-deriving occurrences locally. **Cost accepted:** four implementations, mitigated by a shared `lib/recurrence.js` that `local` and `caldav` both use.

## 2026-08-15 — Recurrence is read-only for now (no series editing)
Expansion + creation shipped; editing/deleting a *series* deliberately did not.
**Why:** expansion fixes a **correctness** bug (availability was wrong about most of a typical week). Series editing is a **feature** with a far wider blast radius — it changes the API path shape, every provider's update/delete, and the client modal. Shipping both together would have put a risky change in the same diff as a correctness fix. `PATCH`/`DELETE` still act on one id, and the assistant guide now instructs the assistant to **ask the user before touching anything carrying a `recurringEventId`**, because Google cancels one occurrence while CalDAV deletes the whole `.ics`.

## 2026-08-15 — Node's built-in test runner, no test framework
`node:test` + `node:assert/strict`, 118 tests, zero added dependencies.
**Why:** the project's own contributing guidance says "small, deliberately simple, dependency-light". `node:test` on Node 20+ covers concurrency, coverage and lifecycle hooks, so adding Vitest or Jest would have contradicted the repo's stated stance.

## 2026-08-15 — Split `app.js` from `server.js`
App construction moved to `src/app.js`; `server.js` only binds the port and prints startup warnings.
**Why:** `server.js` built the app and called `listen()` in one file, so tests couldn't import the real app without binding a port. Splitting lets the HTTP tests drive the genuine middleware stack on an ephemeral port instead of a re-created approximation.

## 2026-08-15 — Secure-by-default: loopback bind + scoped CORS + constant-time key
Defaults changed to `HOST=127.0.0.1`, `CORS_ORIGIN=http://localhost:5173`, and a `timingSafeEqual` API-key comparison.
**Why:** the previous defaults assumed a trusted machine while the docs described a self-hosted, network-reachable tool. `listen(port)` bound **all** interfaces while `API_KEY` was empty by default, so every route was exposed to the local network out of the box. The safe setup should be the one you get by doing nothing.

## 2026-08-15 — `API_PORT` takes precedence over `PORT`
Both the server and the Vite proxy read `API_PORT` first.
**Why:** the server read a bare `PORT` while the proxy hardcoded `:3000`. Launchers commonly inject `PORT` meaning "the port for *this* app", which made the API bind 5173 and steal the UI's port — the client then served nothing and proxied to itself.

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
