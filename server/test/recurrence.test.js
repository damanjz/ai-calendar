import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRecurring, parseRecurrence } from '../src/lib/recurrence.js'
import { findFreeSlots, findConflicts } from '../src/lib/util.js'

const WINDOW = { from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' }

const WEEKLY_STANDUP = {
  id: 'standup',
  title: 'Standup',
  start: '2031-06-02T09:00:00.000Z', // a Monday
  end: '2031-06-02T09:15:00.000Z',
  recurrence: 'RRULE:FREQ=WEEKLY;COUNT=4',
}

test('parseRecurrence: accepts a bare RRULE line and an iCalendar block', () => {
  assert.ok(parseRecurrence('RRULE:FREQ=WEEKLY;COUNT=3', new Date('2031-06-02T09:00:00Z')))
  assert.ok(parseRecurrence('FREQ=WEEKLY;COUNT=3', new Date('2031-06-02T09:00:00Z')))
  assert.ok(parseRecurrence(['RRULE:FREQ=DAILY;COUNT=2'], new Date('2031-06-02T09:00:00Z')))
})

test('parseRecurrence: returns null for absent or unparseable rules', () => {
  const dt = new Date('2031-06-02T09:00:00Z')
  assert.equal(parseRecurrence(null, dt), null)
  assert.equal(parseRecurrence('', dt), null)
  assert.equal(parseRecurrence('not-a-rule', dt), null)
  assert.equal(parseRecurrence('RRULE:FREQ=NONSENSE', dt), null)
})

test('a non-recurring event passes through untouched', () => {
  const plain = { id: 'a', title: 'One-off', start: '2031-06-03T10:00:00.000Z', end: '2031-06-03T11:00:00.000Z' }
  const out = expandRecurring([plain], WINDOW)
  assert.deepEqual(out, [plain])
})

test('a weekly event expands to one instance per occurrence in the window', () => {
  const out = expandRecurring([WEEKLY_STANDUP], WINDOW)
  assert.deepEqual(
    out.map((e) => e.start),
    [
      '2031-06-02T09:00:00.000Z',
      '2031-06-09T09:00:00.000Z',
      '2031-06-16T09:00:00.000Z',
      '2031-06-23T09:00:00.000Z',
    ],
  )
})

test('each instance keeps the original duration', () => {
  for (const e of expandRecurring([WEEKLY_STANDUP], WINDOW)) {
    assert.equal(new Date(e.end) - new Date(e.start), 15 * 60_000)
  }
})

test('instances get unique ids and point back at the series', () => {
  const out = expandRecurring([WEEKLY_STANDUP], WINDOW)
  const ids = out.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'instance ids must be unique')
  for (const e of out) {
    assert.equal(e.recurringEventId, 'standup', 'instance must reference its series')
    assert.ok(e.originalStart, 'instance must record its occurrence start')
    assert.match(e.id, /^standup_/, 'instance id must be derived from the series id')
  }
})

test('the expanded instances no longer carry the rule', () => {
  for (const e of expandRecurring([WEEKLY_STANDUP], WINDOW)) {
    assert.equal(e.recurrence, undefined, 'an instance is concrete, not a rule')
  }
})

test('a series that started before the window still blocks time inside it', () => {
  // The bug this feature exists to fix: a weekly meeting begun last year was
  // invisible, so every one of its occurrences read as free.
  const old = { ...WEEKLY_STANDUP, start: '2030-01-07T09:00:00.000Z', end: '2030-01-07T09:15:00.000Z', recurrence: 'RRULE:FREQ=WEEKLY' }
  const out = expandRecurring([old], WINDOW)
  assert.ok(out.length >= 4, `expected weekly occurrences inside June 2031, got ${out.length}`)
  for (const e of out) {
    assert.ok(new Date(e.start) >= new Date(WINDOW.from))
    assert.ok(new Date(e.start) < new Date(WINDOW.to))
  }
})

test('a finished series contributes nothing to a later window', () => {
  const out = expandRecurring([WEEKLY_STANDUP], { from: '2032-01-01T00:00:00Z', to: '2032-02-01T00:00:00Z' })
  assert.deepEqual(out, [])
})

test('UNTIL is respected', () => {
  const until = { ...WEEKLY_STANDUP, recurrence: 'RRULE:FREQ=WEEKLY;UNTIL=20310610T000000Z' }
  const out = expandRecurring([until], WINDOW)
  assert.deepEqual(out.map((e) => e.start), ['2031-06-02T09:00:00.000Z', '2031-06-09T09:00:00.000Z'])
})

test('EXDATE removes a cancelled occurrence', () => {
  const withEx = {
    ...WEEKLY_STANDUP,
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE:20310609T090000Z'],
  }
  const out = expandRecurring([withEx], WINDOW)
  assert.deepEqual(
    out.map((e) => e.start),
    ['2031-06-02T09:00:00.000Z', '2031-06-16T09:00:00.000Z', '2031-06-23T09:00:00.000Z'],
  )
})

test('an occurrence overlapping the window edge is included', () => {
  // Occurrence starts before `from` but runs past it — it still blocks time.
  const daily = {
    id: 'long', title: 'Long block',
    start: '2031-05-31T23:00:00.000Z', end: '2031-06-01T01:00:00.000Z',
    recurrence: 'RRULE:FREQ=DAILY;COUNT=3',
  }
  const out = expandRecurring([daily], { from: '2031-06-01T00:00:00Z', to: '2031-06-02T00:00:00Z' })
  assert.ok(out.length >= 1, 'an occurrence straddling the window start must be kept')
})

test('an unparseable rule degrades to the single base event rather than vanishing', () => {
  const broken = { ...WEEKLY_STANDUP, recurrence: 'RRULE:FREQ=GARBAGE' }
  const out = expandRecurring([broken], WINDOW)
  assert.equal(out.length, 1)
  assert.equal(out[0].start, WEEKLY_STANDUP.start)
})

test('expansion is capped so a pathological rule cannot exhaust memory', () => {
  const forever = {
    id: 'spam', title: 'Every minute',
    start: '2031-06-01T00:00:00.000Z', end: '2031-06-01T00:01:00.000Z',
    recurrence: 'RRULE:FREQ=MINUTELY',
  }
  const out = expandRecurring([forever], WINDOW)
  assert.ok(out.length > 0)
  assert.ok(out.length <= 1000, `expected a hard cap, got ${out.length} instances`)
})

test('mixed input preserves non-recurring events alongside expanded ones', () => {
  const plain = { id: 'solo', title: 'One-off', start: '2031-06-04T14:00:00.000Z', end: '2031-06-04T15:00:00.000Z' }
  const out = expandRecurring([plain, WEEKLY_STANDUP], WINDOW)
  assert.equal(out.filter((e) => e.id === 'solo').length, 1)
  assert.equal(out.filter((e) => e.recurringEventId === 'standup').length, 4)
})

// ---------------------------------------------------------------------------
// The point of the whole feature: recurrence must reach the booking decision
// ---------------------------------------------------------------------------

test('availability does not offer a slot taken by a later occurrence', () => {
  const expanded = expandRecurring([WEEKLY_STANDUP], WINDOW)
  // 9 June is the SECOND occurrence — the one the old code missed entirely.
  const slots = findFreeSlots(expanded, {
    from: '2031-06-09T09:00:00Z',
    to: '2031-06-09T10:00:00Z',
    duration: 15,
    granularity: 15,
  })
  assert.equal(
    slots.some((s) => s.start === '2031-06-09T09:00:00.000Z'),
    false,
    'the recurring standup must block its own slot',
  )
})

test('conflicts flags a later occurrence of a series', () => {
  const expanded = expandRecurring([WEEKLY_STANDUP], WINDOW)
  const hits = findConflicts(expanded, '2031-06-23T09:00:00Z', '2031-06-23T09:15:00Z')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].recurringEventId, 'standup')
})

test('availability and conflicts still agree once recurrence is in play', () => {
  const expanded = expandRecurring([WEEKLY_STANDUP], WINDOW)
  const slots = findFreeSlots(expanded, {
    from: '2031-06-02T08:00:00Z',
    to: '2031-06-24T18:00:00Z',
    duration: 30,
    granularity: 30,
  })
  assert.ok(slots.length > 0)
  for (const s of slots) {
    assert.deepEqual(findConflicts(expanded, s.start, s.end), [], `offered ${s.start} but it conflicts`)
  }
})
