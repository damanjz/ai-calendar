#!/usr/bin/env node
/**
 * Exercises a LIVE calendar provider against a real account.
 *
 * The automated suite stubs every remote transport, so it proves our request
 * shapes and normalisation but never that the real API behaves as assumed.
 * This script closes that gap.
 *
 *   node scripts/verify-live-provider.mjs google
 *
 * It creates events in a far-future window (year 2038) to stay clear of real
 * appointments, and deletes everything it creates. Read-only checks run first;
 * nothing is written until they pass.
 *
 * Pass --keep to leave the created events behind for manual inspection.
 */

import config from '../src/config.js'
import { getProvider } from '../src/providers/index.js'

const providerId = process.argv[2] || 'google'
const keep = process.argv.includes('--keep')

// Far enough out that it cannot collide with anything real.
const BASE = Date.UTC(2038, 0, 12, 9, 0, 0) // Tue 12 Jan 2038, 09:00 UTC
const iso = (ms) => new Date(ms).toISOString()
const MIN = 60_000

let pass = 0
let fail = 0
const created = []

function ok(label, detail = '') {
  pass++
  console.log(`  [32m✔[0m ${label}${detail ? ` — ${detail}` : ''}`)
}
function bad(label, err) {
  fail++
  console.log(`  [31m✖[0m ${label}\n      ${err?.message || err}`)
}
async function step(label, fn) {
  try {
    const out = await fn()
    ok(label, typeof out === 'string' ? out : '')
    return out
  } catch (err) {
    bad(label, err)
    return null
  }
}

console.log(`\nLive provider check: ${providerId}`)
console.log(`API bind: ${config.host}:${config.port}\n`)

let provider
try {
  provider = getProvider(providerId)
} catch (err) {
  console.error(`[31mCannot use provider "${providerId}":[0m ${err.message}\n`)
  console.error('Fix the configuration first:')
  console.error('  1. server/.env has GOOGLE_ENABLED=true plus client id/secret')
  console.error(`  2. Complete OAuth at http://localhost:${config.port}/api/auth/${providerId}`)
  console.error('  3. Re-run this script\n')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Read-only
// ---------------------------------------------------------------------------

console.log('Read-only checks')

const calendars = await step('list calendars', async () => {
  const list = await provider.getCalendars()
  if (!Array.isArray(list) || !list.length) throw new Error('no calendars returned')
  for (const c of list) {
    if (!c.id) throw new Error(`calendar missing id: ${JSON.stringify(c)}`)
  }
  return `${list.length} calendar(s); primary: ${list.find((c) => c.primary)?.name || '(none flagged)'}`
})

const calendarId = calendars ? calendars.find((c) => c.primary)?.id || calendars[0].id : undefined

await step('read a 30-day window', async () => {
  const from = iso(Date.now())
  const to = iso(Date.now() + 30 * 24 * 60 * MIN)
  const events = await provider.getEvents({ calendarId, from, to })
  for (const e of events.slice(0, 50)) {
    if (!e.id) throw new Error('event missing id')
    if (Number.isNaN(Date.parse(e.start))) throw new Error(`unparseable start: ${e.start}`)
    if (Number.isNaN(Date.parse(e.end))) throw new Error(`unparseable end: ${e.end}`)
    if (e.provider !== providerId) throw new Error(`wrong provider tag: ${e.provider}`)
  }
  const recurring = events.filter((e) => e.recurringEventId)
  return `${events.length} event(s); ${recurring.length} recurring instance(s)`
})

await step('recurring series are EXPANDED, not masters', async () => {
  const from = iso(Date.now())
  const to = iso(Date.now() + 60 * 24 * 60 * MIN)
  const events = await provider.getEvents({ calendarId, from, to })
  const withRule = events.filter((e) => e.recurrence)
  if (withRule.length) {
    throw new Error(`${withRule.length} event(s) still carry a recurrence rule — expansion failed`)
  }
  const series = new Map()
  for (const e of events) {
    if (e.recurringEventId) series.set(e.recurringEventId, (series.get(e.recurringEventId) || 0) + 1)
  }
  const multi = [...series.values()].filter((n) => n > 1).length
  return series.size
    ? `${series.size} series, ${multi} with >1 occurrence in 60 days`
    : 'no recurring events in the next 60 days (inconclusive — add one to test properly)'
})

await step('availability agrees with conflicts', async () => {
  const from = iso(Date.now())
  const to = iso(Date.now() + 7 * 24 * 60 * MIN)
  const slots = await provider.getAvailability({ calendarId, from, to, duration: 30, granularity: 60 })
  const events = await provider.getEvents({ calendarId, from, to })
  for (const s of slots.slice(0, 100)) {
    const clash = events.find(
      (e) => new Date(e.start) < new Date(s.end) && new Date(e.end) > new Date(s.start),
    )
    if (clash) throw new Error(`offered ${s.start} but "${clash.title}" overlaps it`)
  }
  return `${slots.length} free 30-min slot(s) in 7 days, none overlapping a real event`
})

if (fail) {
  console.log(`\n[31mRead-only checks failed — not writing anything.[0m\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Write (year 2038, cleaned up afterwards)
// ---------------------------------------------------------------------------

console.log('\nWrite checks (year 2038 — cleaned up after)')

const single = await step('create a one-off event', async () => {
  const e = await provider.createEvent({
    calendarId,
    event: {
      title: 'ai-calendar live check (delete me)',
      description: 'Created by verify-live-provider.mjs',
      location: '',
      attendees: [],
      allDay: false,
      start: iso(BASE),
      end: iso(BASE + 30 * MIN),
    },
  })
  if (!e?.id) throw new Error('no id returned')
  created.push(e.id)
  return e.id
})

if (single) {
  await step('the created event is readable back', async () => {
    const events = await provider.getEvents({
      calendarId,
      from: iso(BASE - 60 * MIN),
      to: iso(BASE + 120 * MIN),
    })
    const found = events.find((e) => e.id === single || e.recurringEventId === single)
    if (!found) throw new Error('created event not found in its own window')
    if (Math.abs(new Date(found.start).getTime() - BASE) > 1000) {
      throw new Error(`start drifted: sent ${iso(BASE)}, got ${found.start}`)
    }
    return 'round-trips with the same start'
  })

  await step('conflicts reports the new event as busy', async () => {
    const events = await provider.getEvents({
      calendarId,
      from: iso(BASE + 5 * MIN),
      to: iso(BASE + 20 * MIN),
    })
    if (!events.length) throw new Error('an overlapping window returned nothing')
    return `${events.length} overlapping event(s)`
  })

  await step('availability no longer offers the taken slot', async () => {
    const slots = await provider.getAvailability({
      calendarId,
      from: iso(BASE),
      to: iso(BASE + 60 * MIN),
      duration: 30,
      granularity: 30,
    })
    if (slots.some((s) => Math.abs(new Date(s.start).getTime() - BASE) < 1000)) {
      throw new Error('the booked slot is still being offered')
    }
    return `${slots.length} slot(s) offered, none at the booked time`
  })

  await step('update moves the event', async () => {
    const updated = await provider.updateEvent({
      calendarId,
      eventId: single,
      event: {
        title: 'ai-calendar live check (moved)',
        description: '',
        location: '',
        attendees: [],
        allDay: false,
        start: iso(BASE + 120 * MIN),
        end: iso(BASE + 150 * MIN),
      },
    })
    if (Math.abs(new Date(updated.start).getTime() - (BASE + 120 * MIN)) > 1000) {
      throw new Error(`start did not move: ${updated.start}`)
    }
    return 'moved +2h'
  })
}

const series = await step('create a recurring series (weekly x3)', async () => {
  const e = await provider.createEvent({
    calendarId,
    event: {
      title: 'ai-calendar live recurring (delete me)',
      description: '',
      location: '',
      attendees: [],
      allDay: false,
      start: iso(BASE + 24 * 60 * MIN),
      end: iso(BASE + 24 * 60 * MIN + 30 * MIN),
      recurrence: 'RRULE:FREQ=WEEKLY;COUNT=3',
    },
  })
  if (!e?.id) throw new Error('no id returned')
  created.push(e.id)
  return e.id
})

if (series) {
  await step('the series expands to 3 occurrences', async () => {
    const events = await provider.getEvents({
      calendarId,
      from: iso(BASE),
      to: iso(BASE + 40 * 24 * 60 * MIN),
    })
    const mine = events.filter(
      (e) => e.recurringEventId === series || e.id === series || e.title?.includes('live recurring'),
    )
    if (mine.length < 3) {
      throw new Error(
        `expected 3 occurrences, got ${mine.length}. ` +
          'If this provider ignores the recurrence field on write, that is the finding.',
      )
    }
    return `${mine.length} occurrence(s)`
  })
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

if (keep) {
  console.log(`\n[33mLeaving ${created.length} event(s) behind (--keep).[0m`)
  for (const id of created) console.log(`  ${id}`)
} else if (created.length) {
  console.log('\nCleanup')
  for (const id of created) {
    await step(`delete ${id.slice(0, 24)}…`, async () => {
      await provider.deleteEvent({ calendarId, eventId: id, scope: 'all' })
      return 'deleted'
    })
  }
}

console.log(`\n${fail ? '[31m' : '[32m'}${pass} passed, ${fail} failed[0m\n`)
if (fail && created.length && !keep) {
  console.log('[33mSome checks failed — verify your calendar has no leftover "delete me" events.[0m\n')
}
process.exit(fail ? 1 : 0)
