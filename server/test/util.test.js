import test from 'node:test'
import assert from 'node:assert/strict'
import {
  intervalsOverlap,
  findFreeSlots,
  findConflicts,
  minutesToMs,
  msToMinutes,
  isValidIso,
  assertIso,
  assertPositiveInt,
  assertOneOf,
  safeKeyEquals,
  parseWorkingHours,
  localWallClock,
} from '../src/lib/util.js'

const iso = (s) => new Date(s).toISOString()
const ev = (start, end, rest = {}) => ({ start: iso(start), end: iso(end), ...rest })

test('minutesToMs / msToMinutes round-trip', () => {
  assert.equal(minutesToMs(30), 1_800_000)
  assert.equal(msToMinutes(1_800_000), 30)
  assert.equal(msToMinutes(minutesToMs(45)), 45)
})

test('isValidIso accepts ISO strings and rejects junk', () => {
  assert.equal(isValidIso('2030-03-01T09:00:00Z'), true)
  assert.equal(isValidIso('not-a-date'), false)
  assert.equal(isValidIso(''), false)
  assert.equal(isValidIso(null), false)
  assert.equal(isValidIso(20300301), false, 'numbers must not be treated as dates')
})

test('assertIso throws bad_request on invalid input', () => {
  assert.equal(assertIso('2030-03-01T09:00:00Z', 'from').toISOString(), '2030-03-01T09:00:00.000Z')
  assert.throws(() => assertIso('nope', 'from'), (e) => e.code === 'bad_request')
})

test('assertPositiveInt rejects zero, negatives and non-integers', () => {
  assert.equal(assertPositiveInt('30', 'duration'), 30)
  for (const bad of ['0', '-5', '1.5', 'abc', '']) {
    assert.throws(() => assertPositiveInt(bad, 'duration'), (e) => e.code === 'bad_request', `expected reject: ${bad}`)
  }
})

test('assertOneOf enforces membership', () => {
  assert.equal(assertOneOf('local', ['local', 'google'], 'provider'), 'local')
  assert.throws(() => assertOneOf('nope', ['local'], 'provider'), (e) => e.code === 'bad_request')
})

// ---------------------------------------------------------------------------
// intervalsOverlap — the function every booking decision depends on
// ---------------------------------------------------------------------------

test('intervalsOverlap: half-open semantics, touching intervals do NOT overlap', () => {
  const d = (s) => new Date(s)
  // [09:00,10:00) vs [10:00,11:00) — back-to-back meetings are not a conflict
  assert.equal(
    intervalsOverlap(d('2030-03-01T09:00Z'), d('2030-03-01T10:00Z'), d('2030-03-01T10:00Z'), d('2030-03-01T11:00Z')),
    false,
  )
  // identical
  assert.equal(
    intervalsOverlap(d('2030-03-01T09:00Z'), d('2030-03-01T10:00Z'), d('2030-03-01T09:00Z'), d('2030-03-01T10:00Z')),
    true,
  )
  // b fully enclosed by a
  assert.equal(
    intervalsOverlap(d('2030-03-01T09:00Z'), d('2030-03-01T17:00Z'), d('2030-03-01T12:00Z'), d('2030-03-01T12:30Z')),
    true,
  )
  // a fully enclosed by b (symmetry)
  assert.equal(
    intervalsOverlap(d('2030-03-01T12:00Z'), d('2030-03-01T12:30Z'), d('2030-03-01T09:00Z'), d('2030-03-01T17:00Z')),
    true,
  )
  // partial overlap at the tail
  assert.equal(
    intervalsOverlap(d('2030-03-01T09:00Z'), d('2030-03-01T10:00Z'), d('2030-03-01T09:30Z'), d('2030-03-01T10:30Z')),
    true,
  )
  // disjoint
  assert.equal(
    intervalsOverlap(d('2030-03-01T09:00Z'), d('2030-03-01T10:00Z'), d('2030-03-01T14:00Z'), d('2030-03-01T15:00Z')),
    false,
  )
})

// ---------------------------------------------------------------------------
// findFreeSlots
// ---------------------------------------------------------------------------

test('findFreeSlots: empty calendar fills the whole window', () => {
  const slots = findFreeSlots([], {
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T10:00:00Z',
    duration: 30,
    granularity: 30,
  })
  assert.deepEqual(
    slots.map((s) => s.start),
    ['2030-03-01T09:00:00.000Z', '2030-03-01T09:30:00.000Z'],
  )
})

test('findFreeSlots: never returns a slot overlapping a busy event', () => {
  const events = [ev('2030-03-01T09:00:00Z', '2030-03-01T17:00:00Z')]
  const slots = findFreeSlots(events, {
    from: '2030-03-01T08:00:00Z',
    to: '2030-03-01T18:00:00Z',
    duration: 30,
    granularity: 15,
  })
  for (const s of slots) {
    const overlaps = intervalsOverlap(
      new Date(s.start), new Date(s.end),
      new Date(events[0].start), new Date(events[0].end),
    )
    assert.equal(overlaps, false, `slot ${s.start} overlaps the busy block`)
  }
  assert.ok(slots.length > 0, 'should still find slots outside the block')
})

test('findFreeSlots: a slot may start exactly when an event ends', () => {
  const slots = findFreeSlots([ev('2030-03-01T09:00:00Z', '2030-03-01T10:00:00Z')], {
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T11:00:00Z',
    duration: 60,
    granularity: 60,
  })
  assert.deepEqual(slots.map((s) => s.start), ['2030-03-01T10:00:00.000Z'])
})

test('findFreeSlots: fully booked window yields nothing', () => {
  const slots = findFreeSlots([ev('2030-03-01T09:00:00Z', '2030-03-01T10:00:00Z')], {
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T10:00:00Z',
    duration: 30,
    granularity: 15,
  })
  assert.deepEqual(slots, [])
})

test('findFreeSlots: duration longer than the window yields nothing', () => {
  const slots = findFreeSlots([], {
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T09:30:00Z',
    duration: 60,
    granularity: 15,
  })
  assert.deepEqual(slots, [])
})

test('findFreeSlots: gap between two meetings is found', () => {
  const slots = findFreeSlots(
    [ev('2030-03-01T09:00:00Z', '2030-03-01T10:00:00Z'), ev('2030-03-01T11:00:00Z', '2030-03-01T12:00:00Z')],
    { from: '2030-03-01T09:00:00Z', to: '2030-03-01T12:00:00Z', duration: 60, granularity: 60 },
  )
  assert.deepEqual(slots.map((s) => s.start), ['2030-03-01T10:00:00.000Z'])
})

test('findFreeSlots: overlapping busy events are handled (no double-count gap)', () => {
  const slots = findFreeSlots(
    [ev('2030-03-01T09:00:00Z', '2030-03-01T11:00:00Z'), ev('2030-03-01T10:00:00Z', '2030-03-01T12:00:00Z')],
    { from: '2030-03-01T09:00:00Z', to: '2030-03-01T13:00:00Z', duration: 60, granularity: 60 },
  )
  assert.deepEqual(slots.map((s) => s.start), ['2030-03-01T12:00:00.000Z'])
})

test('findFreeSlots: events partially outside the window are clipped, not dropped', () => {
  // Event starts before the window and ends inside it.
  const slots = findFreeSlots([ev('2030-03-01T06:00:00Z', '2030-03-01T10:00:00Z')], {
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T11:00:00Z',
    duration: 60,
    granularity: 60,
  })
  assert.deepEqual(slots.map((s) => s.start), ['2030-03-01T10:00:00.000Z'])
})

test('findFreeSlots: zero-length events cannot block a slot', () => {
  const slots = findFreeSlots([ev('2030-03-01T09:30:00Z', '2030-03-01T09:30:00Z')], {
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T10:00:00Z',
    duration: 60,
    granularity: 60,
  })
  assert.deepEqual(slots.map((s) => s.start), ['2030-03-01T09:00:00.000Z'])
})

test('findFreeSlots: every emitted slot is exactly `duration` long', () => {
  const slots = findFreeSlots([], {
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T12:00:00Z',
    duration: 45,
    granularity: 15,
  })
  assert.ok(slots.length > 0)
  for (const s of slots) {
    assert.equal(new Date(s.end) - new Date(s.start), minutesToMs(45))
  }
})

test('findFreeSlots: slots stay inside the window', () => {
  const from = '2030-03-01T09:00:00Z'
  const to = '2030-03-01T12:00:00Z'
  const slots = findFreeSlots([], { from, to, duration: 30, granularity: 15 })
  for (const s of slots) {
    assert.ok(new Date(s.start) >= new Date(from), 'slot starts before window')
    assert.ok(new Date(s.end) <= new Date(to), 'slot ends after window')
  }
})

test('findFreeSlots: survives a DST transition without emitting bad slots', () => {
  // US DST spring-forward 2030-03-10. Working in UTC, slot maths must stay uniform.
  const slots = findFreeSlots([], {
    from: '2030-03-10T05:00:00Z',
    to: '2030-03-10T11:00:00Z',
    duration: 60,
    granularity: 60,
  })
  assert.equal(slots.length, 6)
  for (const s of slots) {
    assert.equal(new Date(s.end) - new Date(s.start), minutesToMs(60))
  }
})

test('findFreeSlots: unsorted input events still block correctly', () => {
  const slots = findFreeSlots(
    [ev('2030-03-01T11:00:00Z', '2030-03-01T12:00:00Z'), ev('2030-03-01T09:00:00Z', '2030-03-01T10:00:00Z')],
    { from: '2030-03-01T09:00:00Z', to: '2030-03-01T12:00:00Z', duration: 60, granularity: 60 },
  )
  assert.deepEqual(slots.map((s) => s.start), ['2030-03-01T10:00:00.000Z'])
})

// ---------------------------------------------------------------------------
// findConflicts — must agree with findFreeSlots
// ---------------------------------------------------------------------------

test('findConflicts: detects an enclosed proposal', () => {
  const events = [ev('2030-03-01T09:00:00Z', '2030-03-01T17:00:00Z', { title: 'All day block' })]
  const hits = findConflicts(events, '2030-03-01T12:00:00Z', '2030-03-01T12:30:00Z')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].title, 'All day block')
})

test('findConflicts: back-to-back proposal is clear', () => {
  const events = [ev('2030-03-01T09:00:00Z', '2030-03-01T10:00:00Z')]
  assert.deepEqual(findConflicts(events, '2030-03-01T10:00:00Z', '2030-03-01T11:00:00Z'), [])
})

test('availability and conflicts never disagree (the core product claim)', () => {
  const events = [
    ev('2030-03-01T09:00:00Z', '2030-03-01T10:30:00Z'),
    ev('2030-03-01T13:00:00Z', '2030-03-01T14:00:00Z'),
    ev('2030-03-01T15:45:00Z', '2030-03-01T16:15:00Z'),
  ]
  const from = '2030-03-01T08:00:00Z'
  const to = '2030-03-01T18:00:00Z'
  const slots = findFreeSlots(events, { from, to, duration: 30, granularity: 15 })
  assert.ok(slots.length > 0)
  for (const s of slots) {
    assert.deepEqual(
      findConflicts(events, s.start, s.end),
      [],
      `availability offered ${s.start} but conflicts flagged it`,
    )
  }
})

// ---------------------------------------------------------------------------
// working hours + timezone
// ---------------------------------------------------------------------------

test('workingHours restricts slots to the given days and window (UTC)', () => {
  // 2030-03-01 is a Friday. 09:00-17:00 UTC, weekdays only.
  const wh = { days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }
  const slots = findFreeSlots([], {
    from: '2030-03-01T00:00:00Z', // Friday
    to: '2030-03-04T00:00:00Z', // Monday
    duration: 60,
    granularity: 60,
    workingHours: wh,
  })
  const starts = slots.map((s) => s.start)
  assert.equal(starts[0], '2030-03-01T09:00:00.000Z')
  assert.equal(starts.at(-1), '2030-03-01T16:00:00.000Z')
  assert.ok(starts.every((s) => s.startsWith('2030-03-01T')), 'Saturday and Sunday must be skipped')
})

test('workingHours with timeZone interprets the window in local time', () => {
  // 2030-03-01 is before DST, so America/New_York is UTC-5.
  // 09:00-17:00 local == 14:00-22:00 UTC.
  const wh = { days: [5], start: 9 * 60, end: 17 * 60 } // Friday only
  const slots = findFreeSlots([], {
    from: '2030-03-01T00:00:00Z',
    to: '2030-03-02T00:00:00Z',
    duration: 60,
    granularity: 60,
    timeZone: 'America/New_York',
    workingHours: wh,
  })
  const starts = slots.map((s) => s.start)
  assert.equal(starts[0], '2030-03-01T14:00:00.000Z')
  assert.equal(starts.at(-1), '2030-03-01T21:00:00.000Z')
})

test('workingHours: a slot crossing the end of the window is excluded', () => {
  const wh = { days: [5], start: 9 * 60, end: 12 * 60 }
  const slots = findFreeSlots([], {
    from: '2030-03-01T08:00:00Z',
    to: '2030-03-01T13:00:00Z',
    duration: 60,
    granularity: 30,
    workingHours: wh,
  })
  const starts = slots.map((s) => s.start)
  assert.deepEqual(starts, [
    '2030-03-01T09:00:00.000Z',
    '2030-03-01T09:30:00.000Z',
    '2030-03-01T10:00:00.000Z',
    '2030-03-01T10:30:00.000Z',
    '2030-03-01T11:00:00.000Z',
  ], 'slots must end at or before the working-hours end')
})

test('parseWorkingHours: accepts ranges, lists, and defaults', () => {
  assert.deepEqual(parseWorkingHours({ workDays: '1-5', workStart: '09:00', workEnd: '17:00' }), {
    timeZone: undefined,
    workingHours: { days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
  })
  assert.deepEqual(parseWorkingHours({ workDays: '0,6', workStart: '00:00', workEnd: '24:00' }), {
    timeZone: undefined,
    workingHours: { days: [0, 6], start: 0, end: 1440 },
  })
  assert.equal(parseWorkingHours({}), null)
  assert.equal(parseWorkingHours({ timeZone: 'Europe/London' }), null, 'timeZone alone is not working hours')
})

test('parseWorkingHours: rejects malformed input', () => {
  assert.throws(() => parseWorkingHours({ workDays: '1-8' }), /0 \(Sunday\) to 6/)
  assert.throws(() => parseWorkingHours({ workDays: 'x' }), /day numbers/)
  assert.throws(() => parseWorkingHours({ workStart: '9am' }), /HH:MM/)
  assert.throws(() => parseWorkingHours({ workEnd: '17:30', workStart: '18:00' }), /after/)
  assert.throws(() => parseWorkingHours({ workStart: '99:00' }), /valid time/)
  assert.throws(() => parseWorkingHours({ workDays: '1-5', timeZone: 'Mars/Olympus' }), /IANA/)
})

test('localWallClock: matches UTC when no zone is given and handles a zone offset', () => {
  const fri = Date.parse('2030-03-01T15:00:00Z')
  assert.deepEqual(localWallClock(fri), { day: 5, minutes: 15 * 60 })
  assert.deepEqual(localWallClock(fri, 'America/New_York'), { day: 5, minutes: 10 * 60 })
})

// ---------------------------------------------------------------------------
// safeKeyEquals — constant-time API key comparison
// ---------------------------------------------------------------------------

test('safeKeyEquals matches only identical keys', () => {
  assert.equal(safeKeyEquals('s3cret', 's3cret'), true)
  assert.equal(safeKeyEquals('s3cret', 's3crey'), false)
  assert.equal(safeKeyEquals('s3cret', 'longer-value'), false, 'differing lengths must not throw')
  assert.equal(safeKeyEquals('', ''), false, 'empty key is never a match')
  assert.equal(safeKeyEquals(undefined, 's3cret'), false)
  assert.equal(safeKeyEquals('s3cret', undefined), false)
  assert.equal(safeKeyEquals('🔑unicode', '🔑unicode'), true)
})
