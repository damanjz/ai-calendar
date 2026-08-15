---
title: Changelog — AI Calendar
project: AI Calendar
type: changelog
tags:
  - project/ai-calendar
  - changelog
updated: 2026-08-16
---

# Changelog — AI Calendar

> Dated change history for the project. Newest entries at the bottom (append-only). Every project-touching session adds an entry here (Home rule 4). Absolute dates only.

## 2026-08-16 — Feature round + review fixes
- **Ask:** *"we should get it checked"* / critique will land in the repo → features first, then the review.
- **Series-scoped edit/delete** — `PATCH`/`DELETE /api/events/:id?scope=this|following|all`. `local` stores `this` as per-occurrence exceptions, splits the series for `following` (truncates the old via `UNTIL`, creates a new master derived from the new start), rewrites the master for `all`. Google/Outlook support `this`/`all` natively; CalDAV is `all`-only; unsupported scopes → `400`.
- **Timezones & working hours** — `/api/availability` accepts `timeZone` (IANA, DST-safe) + `workDays`/`workStart`/`workEnd`; slots must fit entirely inside the working window.
- **Reminders, categories & search** — `reminders` (minutes-before offsets, validated, sorted, ≤ 10, ≤ 28 days), `category` (≤ 50 chars), `?q=` search over title/description/location/category, `GET /api/reminders` (defaults next 24 h; per-occurrence triggers for recurring series).
- **ICS import/export** — `POST /api/import/ics` (validates each VEVENT, RRULE → series master, reports per-event `errors`) and `GET /api/export/ics` (`text/calendar`; uses a provider's raw unexpanded masters when available).
- **Deps** — `googleapis ^173.0.0`, `node-ical ^0.22.0` → **npm audit: 0 vulnerabilities** (pre-existing moderate findings gone; no overrides needed).
- **Docs** — root + `server/` READMEs and `server/docs/assistant-guide.md` updated (scope, availability params, reminders/search/import-export, model fields).
- Verified: **154 tests** pass, lint clean, build passes. Committed as `2351cc5` and pushed; rebased over the vault-note commits pushed from the main PC.
- **Review round (main PC)** — three defects found reviewing `2351cc5`, shipped as failing tests (`0fd0863`) then fixes (`583af5a`), plus `c70a870`:
  1. **HIGH** `/api/reminders` fetched events over the *same* window as the trigger times, so a reminder due 09:00 for a 10:00 event was invisible to "next 30 minutes". Now widens the event fetch by the largest permitted offset; offsets capped at 28 days via one exported `MAX_REMINDER_LEAD_MINUTES`.
  2. **MEDIUM** an oversized ICS returned 500. JSON limit now derived from `MAX_ICS_BYTES` so the route's own 5 MB check fires with a message naming the ICS document; anything past the parser ceiling returns a clean `413 payload_too_large`; bytes counted, not JS string length.
  3. **MEDIUM** export requested an ~8000-year window. `getRawEvents` moved onto the base provider contract with a bounded default; the route accepts `from`/`to` (±1 year default). `local` still exports its whole store.
  4. **OAuth** redirect URIs were built from `PORT` while the server bound `API_PORT` — Google/Microsoft were told to call back on a dead port. Resolved once, derived from the real bind port; explicit `*_REDIRECT_URI` env still wins. `config.test.js` + `scripts/verify-live-provider.mjs` (`npm run verify:live -w server`) added.
- Verified: **163 tests** pass, lint clean.

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

## 2026-08-15 — Published to GitHub, then hardened (PR #1)
- **Ask:** *"add a new repo in git, look for vault in the repo files… append to vault and analized"* → then *"can we make it better"* → *"make it better in every aspect and… fix anything that seems fixing"* → *"push"* → *"merge it"*.
- Repo published public (MIT) at **https://github.com/damanjz/ai-calendar**; cloned to `G:\Claude Projects\ai-calendar`. (Note: the `vault/` folder was pushed one minute *after* the clone, so the first analysis pass read `server/docs/assistant-guide.md` as the context file instead.)
- **Tests from zero → 118 tests, 90.7% line coverage**, using built-in `node:test` (no test-framework dependency). Covers the availability engine's edge cases (enclosed / touching / zero-length / unsorted / DST-crossing intervals), request validation, the local provider's CRUD lifecycle, the remote adapters against stubbed transports, and the HTTP layer end to end. One property asserted directly: *every slot `availability` offers is reported clear by `conflicts`*.
- **Bug fixed — the Google provider crashed on every call.** `calendar()` was `async`, so `await this.calendar().events.list()` read `.events` off a **pending Promise** before the await resolved. All five call sites; the provider was dead on arrival. Merged into one awaited `client()`; a source-grep test locks the pattern out. Also: clear error when unauthenticated, `calendarId` defaults to `primary`, tolerates a missing `items` array, and auth errors are no longer relabelled `502`.
- **Security defaults tightened:** constant-time API-key comparison (was `!==`, leaking prefix length via timing) · binds `127.0.0.1` by default (was all interfaces, with `API_KEY` empty by default) · CORS defaults to the UI origin (was `*`) · OAuth tokens written `0600` · `Math.random()` removed from the OAuth `state` (it's a CSRF defence) · `x-powered-by` disabled · startup warns when bound off-loopback without a key.
- **Smaller fixes:** `parseConflictBody` now requires `start` and rejects non-integer durations (`1.5` previously produced a fractional-minute window) · `/api/events` rejects an inverted window, matching `/api/availability` · API and UI could fight over a port (`API_PORT` now wins on both sides) · `base.js` stub signatures destructured `{ _calendarId }` while callers pass `{ calendarId }`, so the documented params were always `undefined`.
- Docs: README gained **Tests** and **Security posture** sections; config table corrected; `server/docs/assistant-guide.md` notes that `/health` never needs the API key.
- Verified: 118 tests pass, lint clean, client builds, and the full book → conflict → availability → delete path exercised through the running UI in a browser.

## 2026-08-15 — Recurring events (RRULE) expanded across all providers
- **Ask:** *"recurring events (RRULE)"* chosen as the next round. (Note: RRULE was in the original **deferred** scoping pick — this round delivers the *correctness* half only, not the full feature.)
- **The bug:** the availability engine is purely interval-based, so a recurring event left as a master carrying a rule blocked only its **first** occurrence. Worse, the window filter dropped any series that began before the requested range — so **all** of its occurrences read as free. Demonstrated: a weekly standup started in 2030 returned **0 events** for June 2031, meaning an assistant would have booked over all four occurrences. Real calendars are mostly recurring, so this was wrong about most of a typical week.
- **New `server/src/lib/recurrence.js`** — `expandRecurring()` / `parseRecurrence()`, capped at 1000 instances per series. The iterator stops *at* the cap rather than materialising every occurrence and slicing after: an unbounded `FREQ=MINUTELY` rule went **9s → 130ms**.
- **All four providers now return series expanded**, one instance per occurrence in `[from, to)`:
  - `google` — already correct via `singleEvents: true`; now surfaces `recurringEventId` / `originalStart` instead of discarding them.
  - `outlook` — **was silently wrong.** `startDateTime`/`endDateTime` are ignored on `/me/events`, which returns series *masters*, so a weekly meeting appeared once at its series start and blocked nothing else. Switched to `/me/calendarView`, Graph's own expansion.
  - `caldav` — `node-ical` parses the RRULE into a live object but **never expands it**; occurrences now generated with `rrule`, honouring `EXDATE` and `RECURRENCE-ID` overrides. Fetch split from parse so the transport is one testable seam.
  - `local` — expands from the stored rule **before** the window filter.
- Instances get a unique `id` (`<seriesId>_<timestamp>`) — the client keys render lists on `id`, so collisions would mis-reconcile — plus `recurringEventId` and `originalStart`, and never the rule itself.
- `POST /api/book` accepts a `recurrence` rule (local provider), **validated at write time** so a malformed rule is a `400` rather than a silently one-off event.
- `rrule` declared explicitly as a dependency (it was only reachable as a hoisted transitive dep of `node-ical`).
- **Deliberately excluded:** series-scoped edit/delete — see [[Decisions]]. The assistant guide now tells the assistant to ask the user before touching anything with a `recurringEventId`.
- 37 new tests (**118 total**). Verified in a browser: booked a real weekly series and confirmed the **third** occurrence was reported busy and withheld from availability — the exact case the old code got wrong.
- **Shipped:** branch `harden-tests-and-security` (7 commits) pushed, **PR #1 opened and merged** into `master` (merge commit `6d6e3b3`, 29 files, +2472/−120).

## 2026-08-15 — Series scope, working hours, ICS, search + reminders (`2351cc5`)

Shipped from the other side of the collaboration (a second agent working the same repo).

- **Series-scoped edit/delete** — `PATCH`/`DELETE` accept `scope=this|following|all`. `local`
  implements all three: `this` stores a per-occurrence exception, `following` splits the series
  (caps the old rule with `UNTIL`, re-anchors a new master, partitions exceptions across the split).
  Google/Outlook support `this` and `all` natively; CalDAV only `all`.
- **Working hours + timezone** on availability — `workDays` / `workStart` / `workEnd` / `timeZone`,
  with real IANA handling via `Intl` rather than naive offset maths.
- **ICS import/export** — `POST /api/import/ics`, `GET /api/export/ics`; RRULEs preserved as series
  masters on round-trip.
- **Search, categories, reminders** — `?q=` filters title/description/location/category;
  `/api/reminders` lists events whose reminders fire in a window; both `category` and `reminders`
  validated on write (≤10 entries, deduped, non-negative integers).
- **Dependencies:** googleapis → 173, node-ical → 0.22. **`npm audit`: 0 vulnerabilities**, clearing
  the transitive `uuid` findings previously written off as unfixable-without-a-breaking-major.
- 154 tests passing at this commit.

## 2026-08-16 — Review of `2351cc5`: three defects found and fixed

Reviewed the incoming work, verified each finding by running it, and pushed **failing tests first**
(`0fd0863`) so the intended behaviour was unambiguous, then the fixes (`583af5a`).

- **HIGH — `/api/reminders` missed the reminders it exists to report.** It fetched events over the
  *same* window as the trigger times, so a reminder due 09:00 for a 10:00 event was invisible to an
  08:30–09:30 query — exactly the "what's coming up in the next 30 minutes?" case. Verified live
  (`[]` vs 1 expected). **Fixed:** widens the event fetch by the largest permitted offset, then
  filters triggers to `[from, to)`. That needs an upper bound to stay correct, so reminder offsets
  are now capped at **28 days** on write, with both sides deriving from one exported
  `MAX_REMINDER_LEAD_MINUTES`.
- **MEDIUM — an oversized ICS returned `500 Internal server error`.** The route's 5 MB check was
  unreachable: `express.json({limit:'1mb'})` rejected first and `entity.too.large` was untranslated.
  **Fixed:** the JSON limit is derived from `MAX_ICS_BYTES` so the route's own check fires with a
  message naming the ICS document, and anything past the parser ceiling returns
  `413 payload_too_large`. Also measures **bytes** rather than JS string length, so multi-byte
  content is bounded correctly.
- **MEDIUM — ICS export requested an ~8000-year window.** `getRawEvents` was duck-typed, so
  google/outlook/caldav fell back to `1970 → 9999` — a full-history sweep with no pagination guard,
  where recurring series silently truncate at the expansion cap. **Fixed:** `getRawEvents` is on the
  base contract with a bounded default; the route accepts `from`/`to` defaulting to ±1 year. `local`
  still ignores the window and exports its whole store, so its export stays complete.

## 2026-08-16 — OAuth redirect URI followed the wrong port (`c70a870`)

Found while preparing the Google live test — before any credentials were involved.

- `config.js` resolved the bind port from `API_PORT || PORT`, but **both** provider redirect URIs
  were still built from `PORT` alone. With `API_PORT=3000` (what `npm run dev` sets) and no `PORT`,
  the server listened on 3000 while Google/Microsoft were told to call back on 3000 *by luck*; with
  `API_PORT=4000` consent would succeed and then redirect to a **dead port**. The failure appears
  only in the live OAuth flow and reads like a provider problem.
- **Fixed:** the port is resolved once and both redirect URIs derive from it. An explicit
  `GOOGLE_REDIRECT_URI` / `OUTLOOK_REDIRECT_URI` still wins.
- Added `test/config.test.js` — precedence rule, redirect/port agreement across `API_PORT` / `PORT` /
  defaults, and the safe defaults (loopback bind, scoped CORS).
- Added `server/scripts/verify-live-provider.mjs` (`npm run verify:live -w server`) — the real-account
  harness: read-only checks first (calendars, normalized shape, series come back **expanded**,
  availability never overlaps a real event), then create/read/move/delete in a **January 2038**
  window, cleaned up afterwards. Nothing is written until the read-only checks pass.
- **163 tests, 92.2% line coverage.**
