import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolate storage and force a known config before the app is imported.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-api-'))
process.env.DATA_DIR = TMP
process.env.PROVIDERS = 'local'
process.env.API_KEY = 'test-secret-key'
process.env.CORS_ORIGIN = 'http://localhost:5173'

const { createApp } = await import('../src/app.js')

const app = createApp()
let server
let base

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(TMP, { recursive: true, force: true })
})

const KEY = { 'x-api-key': 'test-secret-key' }

async function call(path, options = {}) {
  const res = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body, headers: res.headers }
}

async function book(overrides = {}) {
  return call('/api/book', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({
      provider: 'local',
      calendarId: 'work',
      title: 'Team sync',
      start: '2031-06-02T09:00:00Z',
      end: '2031-06-02T09:30:00Z',
      ...overrides,
    }),
  })
}

// ---------------------------------------------------------------------------
// Health & auth
// ---------------------------------------------------------------------------

test('GET /health is public and reports provider readiness', async () => {
  const { status, body } = await call('/health')
  assert.equal(status, 200)
  assert.equal(body.status, 'ok')
  const local = body.providers.find((p) => p.id === 'local')
  assert.equal(local.ready, true)
  assert.equal(local.active, true)
})

test('/api/* requires the API key when one is configured', async () => {
  const { status, body } = await call('/api/providers')
  assert.equal(status, 401)
  assert.equal(body.error.code, 'unauthorized')
})

test('a wrong API key is rejected', async () => {
  const { status } = await call('/api/providers', { headers: { 'x-api-key': 'wrong' } })
  assert.equal(status, 401)
})

test('the API key is accepted via x-api-key and via Bearer', async () => {
  assert.equal((await call('/api/providers', { headers: KEY })).status, 200)
  assert.equal(
    (await call('/api/providers', { headers: { authorization: 'Bearer test-secret-key' } })).status,
    200,
  )
})

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

test('CORS echoes the configured origin, not a wildcard', async () => {
  const { headers } = await call('/health')
  assert.equal(headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.notEqual(headers.get('access-control-allow-origin'), '*')
})

test('preflight OPTIONS is answered without the API key', async () => {
  const res = await fetch(base + '/api/events', { method: 'OPTIONS' })
  assert.equal(res.status, 204)
  assert.match(res.headers.get('access-control-allow-methods') || '', /PATCH/)
})

// ---------------------------------------------------------------------------
// Routing & error envelope
// ---------------------------------------------------------------------------

test('unknown route returns the standard error envelope', async () => {
  const { status, body } = await call('/api/nope', { headers: KEY })
  assert.equal(status, 404)
  assert.equal(body.error.code, 'not_found')
})

test('unknown provider returns bad_request, not a crash', async () => {
  const { status, body } = await call('/api/calendars?provider=nope', { headers: KEY })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'bad_request')
})

test('malformed JSON body returns bad_request', async () => {
  const res = await fetch(base + '/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...KEY },
    body: '{ not json',
  })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'bad_request')
})

test('an unconfigured provider reports itself as such', async () => {
  const { status, body } = await call('/api/calendars?provider=google', { headers: KEY })
  assert.equal(status, 400)
  assert.match(body.error.message, /not configured/i)
})

// ---------------------------------------------------------------------------
// The booking workflow end to end
// ---------------------------------------------------------------------------

test('full workflow: availability → conflicts → book → conflicts → delete', async () => {
  const window = 'from=2031-06-02T08:00:00Z&to=2031-06-02T12:00:00Z'

  const before = await call(`/api/availability?provider=local&calendarId=work&${window}&duration=30&granularity=30`, { headers: KEY })
  assert.equal(before.status, 200)
  assert.ok(before.body.slots.some((s) => s.start === '2031-06-02T09:00:00.000Z'))

  const clearBefore = await call('/api/conflicts', {
    method: 'POST', headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', start: '2031-06-02T09:00:00Z', end: '2031-06-02T09:30:00Z' }),
  })
  assert.equal(clearBefore.body.clear, true)

  const created = await book()
  assert.equal(created.status, 201)
  assert.equal(created.body.booked, true)
  const id = created.body.event.id

  const clearAfter = await call('/api/conflicts', {
    method: 'POST', headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', start: '2031-06-02T09:00:00Z', end: '2031-06-02T09:30:00Z' }),
  })
  assert.equal(clearAfter.body.clear, false, 'the slot must be busy once booked')
  assert.equal(clearAfter.body.conflicts[0].id, id)

  const after = await call(`/api/availability?provider=local&calendarId=work&${window}&duration=30&granularity=30`, { headers: KEY })
  assert.equal(
    after.body.slots.some((s) => s.start === '2031-06-02T09:00:00.000Z'),
    false,
    'availability must no longer offer the booked slot',
  )

  const del = await call(`/api/events/${id}?provider=local&calendarId=work`, { method: 'DELETE', headers: KEY })
  assert.equal(del.status, 200)
  assert.equal(del.body.deleted, true)
})

test('PATCH reschedules an event and frees the original slot', async () => {
  const created = await book({ start: '2031-06-03T09:00:00Z', end: '2031-06-03T09:30:00Z' })
  const id = created.body.event.id

  const patched = await call(`/api/events/${id}?provider=local&calendarId=work`, {
    method: 'PATCH', headers: KEY,
    body: JSON.stringify({ title: 'Team sync', start: '2031-06-03T11:00:00Z', end: '2031-06-03T11:30:00Z' }),
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.body.event.start, '2031-06-03T11:00:00.000Z')
  assert.equal(patched.body.event.id, id)

  const conflicts = await call('/api/conflicts', {
    method: 'POST', headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', start: '2031-06-03T09:00:00Z', end: '2031-06-03T09:30:00Z' }),
  })
  assert.equal(conflicts.body.clear, true, 'the original slot must be free again')

  await call(`/api/events/${id}?provider=local&calendarId=work`, { method: 'DELETE', headers: KEY })
})

test('booking validation rejects a bad payload', async () => {
  const noTitle = await book({ title: '' })
  assert.equal(noTitle.status, 400)
  assert.equal(noTitle.body.error.code, 'bad_request')

  const inverted = await book({ start: '2031-06-04T10:00:00Z', end: '2031-06-04T09:00:00Z' })
  assert.equal(inverted.status, 400)
})

test('deleting an unknown event returns not_found', async () => {
  const { status, body } = await call('/api/events/does-not-exist?provider=local&calendarId=work', {
    method: 'DELETE', headers: KEY,
  })
  assert.equal(status, 404)
  assert.equal(body.error.code, 'not_found')
})

test('availability rejects an inverted window and a bad duration', async () => {
  const inverted = await call('/api/availability?provider=local&from=2031-06-02T12:00:00Z&to=2031-06-02T08:00:00Z&duration=30', { headers: KEY })
  assert.equal(inverted.status, 400)

  const badDuration = await call('/api/availability?provider=local&from=2031-06-02T08:00:00Z&to=2031-06-02T12:00:00Z&duration=0', { headers: KEY })
  assert.equal(badDuration.status, 400)
})

test('events endpoint rejects invalid dates', async () => {
  const { status, body } = await call('/api/events?provider=local&from=nonsense&to=also-nonsense', { headers: KEY })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'bad_request')
})

// ---------------------------------------------------------------------------
// Recurring events over HTTP
// ---------------------------------------------------------------------------

test('a recurring booking is expanded on read and blocks every occurrence', async () => {
  const created = await book({
    title: 'Weekly standup',
    start: '2031-09-01T09:00:00Z', // a Monday
    end: '2031-09-01T09:30:00Z',
    recurrence: 'RRULE:FREQ=WEEKLY;COUNT=4',
  })
  assert.equal(created.status, 201)
  const seriesId = created.body.event.id

  const window = 'from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z'
  const listed = await call(`/api/events?provider=local&calendarId=work&${window}`, { headers: KEY })
  assert.equal(listed.body.count, 4, 'four occurrences should be returned, not one master')
  assert.equal(listed.body.events.every((e) => e.recurringEventId === seriesId), true)
  assert.equal(new Set(listed.body.events.map((e) => e.id)).size, 4, 'instance ids must be unique')

  // The THIRD occurrence must be busy — the case the old code got wrong.
  const conflict = await call('/api/conflicts', {
    method: 'POST', headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', start: '2031-09-15T09:00:00Z', end: '2031-09-15T09:30:00Z' }),
  })
  assert.equal(conflict.body.clear, false, 'a later occurrence must be reported busy')

  // ... and availability must not offer it.
  const avail = await call(
    `/api/availability?provider=local&calendarId=work&from=2031-09-15T09:00:00Z&to=2031-09-15T10:00:00Z&duration=30&granularity=30`,
    { headers: KEY },
  )
  assert.equal(
    avail.body.slots.some((s) => s.start === '2031-09-15T09:00:00.000Z'),
    false,
    'availability must not offer a slot held by a recurring occurrence',
  )

  await call(`/api/events/${seriesId}?provider=local&calendarId=work`, { method: 'DELETE', headers: KEY })
})

test('an invalid recurrence rule is rejected at write time', async () => {
  const { status, body } = await book({
    title: 'Broken', start: '2031-10-01T09:00:00Z', end: '2031-10-01T09:30:00Z',
    recurrence: 'RRULE:FREQ=NONSENSE',
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'bad_request')
  assert.match(body.error.message, /recurrence/i)
})

test('a non-recurring booking is unchanged by the recurrence feature', async () => {
  const created = await book({ title: 'One-off', start: '2031-11-03T09:00:00Z', end: '2031-11-03T09:30:00Z' })
  assert.equal(created.status, 201)
  assert.equal(created.body.event.recurrence, undefined)

  const listed = await call(
    '/api/events?provider=local&calendarId=work&from=2031-11-01T00:00:00Z&to=2031-11-30T00:00:00Z',
    { headers: KEY },
  )
  assert.equal(listed.body.count, 1)
  assert.equal(listed.body.events[0].recurringEventId, undefined)

  await call(`/api/events/${created.body.event.id}?provider=local&calendarId=work`, { method: 'DELETE', headers: KEY })
})

// ---------------------------------------------------------------------------
// Working hours + timezone over HTTP
// ---------------------------------------------------------------------------

test('availability honours workDays/workStart/workEnd query params', async () => {
  // 2031-09-01 is a Monday. Restrict to weekdays 09:00-17:00 UTC.
  const qs = 'provider=local&calendarId=work&from=2031-09-05T00:00:00Z&to=2031-09-07T00:00:00Z&duration=60&granularity=60'
  const withHours = await call(`/api/availability?${qs}&workDays=5&workStart=09:00&workEnd=17:00`, { headers: KEY })
  assert.equal(withHours.status, 200)
  const starts = withHours.body.slots.map((s) => s.start)
  assert.equal(starts[0], '2031-09-05T09:00:00.000Z')
  assert.equal(starts.at(-1), '2031-09-05T16:00:00.000Z')
  assert.equal(starts.some((s) => s.startsWith('2031-09-06T')), false, 'Saturday must be excluded')
})

test('availability rejects a bad timezone or clock format', async () => {
  const base = 'provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-02T00:00:00Z&duration=30'
  const badTz = await call(`/api/availability?${base}&timeZone=Mars/Olympus`, { headers: KEY })
  assert.equal(badTz.status, 400)
  assert.match(badTz.body.error.message, /IANA/)
  const badClock = await call(`/api/availability?${base}&workStart=9am`, { headers: KEY })
  assert.equal(badClock.status, 400)
  assert.match(badClock.body.error.message, /HH:MM/)
})
