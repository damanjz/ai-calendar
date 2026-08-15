import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEventBody, parseConflictBody } from '../src/lib/validate.js'

const badRequest = (e) => e.code === 'bad_request'

test('parseEventBody: accepts a well-formed event and normalises to ISO', () => {
  const out = parseEventBody({
    title: '  Coffee with Sam  ',
    start: '2030-03-01T14:00:00Z',
    end: '2030-03-01T14:30:00Z',
    description: '  Discuss the proposal ',
    location: ' Blue Bottle ',
    attendees: ['sam@example.com', ' nope ', 'x@y.co'],
  })
  assert.equal(out.title, 'Coffee with Sam')
  assert.equal(out.description, 'Discuss the proposal')
  assert.equal(out.location, 'Blue Bottle')
  assert.deepEqual(out.attendees, ['sam@example.com', 'x@y.co'], 'non-email entries are dropped')
  assert.equal(out.start, '2030-03-01T14:00:00.000Z')
  assert.equal(out.end, '2030-03-01T14:30:00.000Z')
  assert.equal(out.allDay, false)
})

test('parseEventBody: title is required and length-capped', () => {
  assert.throws(() => parseEventBody({ start: '2030-03-01T14:00:00Z', end: '2030-03-01T15:00:00Z' }), badRequest)
  assert.throws(() => parseEventBody({ title: '   ', start: '2030-03-01T14:00:00Z', end: '2030-03-01T15:00:00Z' }), badRequest)
  assert.throws(
    () => parseEventBody({ title: 'x'.repeat(201), start: '2030-03-01T14:00:00Z', end: '2030-03-01T15:00:00Z' }),
    badRequest,
  )
})

test('parseEventBody: rejects missing, invalid, or inverted times', () => {
  const base = { title: 'Meeting' }
  assert.throws(() => parseEventBody({ ...base }), badRequest)
  assert.throws(() => parseEventBody({ ...base, start: 'nope', end: '2030-03-01T15:00:00Z' }), badRequest)
  assert.throws(
    () => parseEventBody({ ...base, start: '2030-03-01T15:00:00Z', end: '2030-03-01T14:00:00Z' }),
    badRequest,
    'end before start must be rejected',
  )
  assert.throws(
    () => parseEventBody({ ...base, start: '2030-03-01T15:00:00Z', end: '2030-03-01T15:00:00Z' }),
    badRequest,
    'zero-length event must be rejected',
  )
})

test('parseEventBody: non-string / non-array optional fields degrade safely', () => {
  const out = parseEventBody({
    title: 'Meeting',
    start: '2030-03-01T14:00:00Z',
    end: '2030-03-01T15:00:00Z',
    description: 42,
    location: null,
    attendees: 'sam@example.com',
    allDay: 'yes',
  })
  assert.equal(out.description, '')
  assert.equal(out.location, '')
  assert.deepEqual(out.attendees, [])
  assert.equal(out.allDay, true)
})

test('parseConflictBody: start + end', () => {
  const out = parseConflictBody({ start: '2030-03-01T09:00:00Z', end: '2030-03-01T09:30:00Z' })
  assert.deepEqual(out, { start: '2030-03-01T09:00:00.000Z', end: '2030-03-01T09:30:00.000Z' })
})

test('parseConflictBody: start + duration derives the end', () => {
  const out = parseConflictBody({ start: '2030-03-01T09:00:00Z', duration: 45 })
  assert.equal(out.end, '2030-03-01T09:45:00.000Z')
})

test('parseConflictBody: a missing start is rejected even when duration is valid', () => {
  // Regression: the original guard passed when duration was valid but start was absent.
  assert.throws(() => parseConflictBody({ duration: 30 }), badRequest)
  assert.throws(() => parseConflictBody({}), badRequest)
  assert.throws(() => parseConflictBody({ start: 'nonsense', duration: 30 }), badRequest)
})

test('parseConflictBody: rejects non-positive / non-integer durations', () => {
  for (const duration of [0, -30, 1.5, 'abc']) {
    assert.throws(
      () => parseConflictBody({ start: '2030-03-01T09:00:00Z', duration }),
      badRequest,
      `expected reject: ${duration}`,
    )
  }
})

test('parseConflictBody: rejects an inverted window', () => {
  assert.throws(
    () => parseConflictBody({ start: '2030-03-01T10:00:00Z', end: '2030-03-01T09:00:00Z' }),
    badRequest,
  )
})
