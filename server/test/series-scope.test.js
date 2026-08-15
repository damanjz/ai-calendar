import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandRecurring } from '../src/lib/recurrence.js'

// Isolate storage and force a known config before the app is imported.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-series-scope-'))
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
  return { status: res.status, body }
}

const WINDOW = 'from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z'
const SERIES = {
  title: 'Weekly standup',
  start: '2031-09-01T09:00:00Z', // a Monday
  end: '2031-09-01T09:30:00Z',
  recurrence: 'RRULE:FREQ=WEEKLY;COUNT=4',
}

async function bookSeries() {
  const { status, body } = await call('/api/book', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', ...SERIES }),
  })
  assert.equal(status, 201)
  return body.event.id
}

async function instances(seriesId) {
  const listed = await call(`/api/events?provider=local&calendarId=work&${WINDOW}`, { headers: KEY })
  return listed.body.events.filter((e) => e.recurringEventId === seriesId)
}

async function allInstances() {
  const listed = await call(`/api/events?provider=local&calendarId=work&${WINDOW}`, { headers: KEY })
  return listed.body.events
}

async function patch(eventId, overrides, scope) {
  const qs = new URLSearchParams({ provider: 'local', calendarId: 'work' })
  if (scope) qs.set('scope', scope)
  return call(`/api/events/${eventId}?${qs}`, {
    method: 'PATCH',
    headers: KEY,
    body: JSON.stringify({ title: 'Edited', start: '2031-09-08T10:00:00Z', end: '2031-09-08T10:30:00Z', ...overrides }),
  })
}

// ---------------------------------------------------------------------------
// expandRecurring honours exceptions (the storage primitive behind scope=this)
// ---------------------------------------------------------------------------

const MASTER = {
  id: 'series',
  title: 'Standup',
  start: '2031-09-01T09:00:00.000Z',
  end: '2031-09-01T09:30:00.000Z',
  recurrence: 'RRULE:FREQ=WEEKLY;COUNT=4',
}

test('an edited exception replaces only that occurrence', () => {
  const out = expandRecurring(
    [{ ...MASTER, exceptions: { '20310908T090000Z': { start: '2031-09-08T10:00:00Z', end: '2031-09-08T10:30:00Z', title: 'Moved' } } }],
    { from: '2031-09-01T00:00:00Z', to: '2031-09-30T00:00:00Z' },
  )
  const moved = out.find((e) => e.originalStart === '2031-09-08T09:00:00.000Z')
  assert.ok(moved, 'the exception must still exist as an instance')
  assert.equal(moved.start, '2031-09-08T10:00:00.000Z')
  assert.equal(moved.title, 'Moved')
  assert.equal(moved.recurringEventId, 'series')
  // Id stays anchored to the ORIGINAL occurrence so the client can reconcile.
  assert.equal(moved.id, 'series_20310908T090000Z')
  assert.equal(out.length, 4, 'an edit moves an occurrence, it does not add one')
})

test('a deleted exception removes only that occurrence', () => {
  const out = expandRecurring(
    [{ ...MASTER, exceptions: { '20310915T090000Z': { deleted: true } } }],
    { from: '2031-09-01T00:00:00Z', to: '2031-09-30T00:00:00Z' },
  )
  assert.deepEqual(
    out.map((e) => e.originalStart),
    ['2031-09-01T09:00:00.000Z', '2031-09-08T09:00:00.000Z', '2031-09-22T09:00:00.000Z'],
  )
})

test('exceptions never leak onto the returned instances', () => {
  const out = expandRecurring(
    [{ ...MASTER, exceptions: { '20310908T090000Z': { deleted: true } } }],
    { from: '2031-09-01T00:00:00Z', to: '2031-09-30T00:00:00Z' },
  )
  assert.equal(out.every((e) => e.exceptions === undefined), true)
})

// ---------------------------------------------------------------------------
// scope=this — edit or cancel a single occurrence over the HTTP API
// ---------------------------------------------------------------------------

test('scope=this edits one occurrence and leaves the rest intact', async () => {
  const seriesId = await bookSeries()
  const before = await instances(seriesId)
  const target = before.find((e) => e.originalStart === '2031-09-08T09:00:00.000Z')

  const { status, body } = await patch(target.id, {}, 'this')
  assert.equal(status, 200)
  assert.equal(body.event.title, 'Edited')
  assert.equal(body.event.start, '2031-09-08T10:00:00.000Z')
  assert.equal(body.scope, 'this')

  const after = await instances(seriesId)
  assert.equal(after.length, 4)
  const moved = after.find((e) => e.originalStart === '2031-09-08T09:00:00.000Z')
  assert.equal(moved.start, '2031-09-08T10:00:00.000Z')
  assert.equal(moved.title, 'Edited')
  assert.ok(after.every((e) => e.start === e.originalStart || e.recurringEventId === seriesId))

  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

test('scope=this cancels one occurrence', async () => {
  const seriesId = await bookSeries()
  const before = await instances(seriesId)
  const target = before.find((e) => e.originalStart === '2031-09-15T09:00:00.000Z')

  const { status } = await call(`/api/events/${target.id}?provider=local&calendarId=work&scope=this`, {
    method: 'DELETE',
    headers: KEY,
  })
  assert.equal(status, 200)

  const after = await instances(seriesId)
  assert.equal(after.length, 3)
  assert.equal(after.some((e) => e.originalStart === '2031-09-15T09:00:00.000Z'), false)

  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

// ---------------------------------------------------------------------------
// scope=all — edit or delete the whole series
// ---------------------------------------------------------------------------

test('scope=all retitles every occurrence', async () => {
  const seriesId = await bookSeries()
  const { status } = await patch(seriesId, { title: 'Retitled', recurrence: 'RRULE:FREQ=WEEKLY;COUNT=4' }, 'all')
  assert.equal(status, 200)

  const after = await instances(seriesId)
  assert.equal(after.length, 4)
  assert.equal(after.every((e) => e.title === 'Retitled'), true)

  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

test('deleting the series id removes every occurrence (backward compatible)', async () => {
  const seriesId = await bookSeries()
  const { status } = await call(`/api/events/${seriesId}?provider=local&calendarId=work`, { method: 'DELETE', headers: KEY })
  assert.equal(status, 200)
  assert.deepEqual(await instances(seriesId), [])
})

// ---------------------------------------------------------------------------
// scope=following — split the series at the edited occurrence
// ---------------------------------------------------------------------------

test('scope=following moves this and all later occurrences into a new series', async () => {
  const seriesId = await bookSeries()
  const before = await instances(seriesId)
  const target = before.find((e) => e.originalStart === '2031-09-15T09:00:00.000Z') // 3rd of 4

  const { status, body } = await patch(target.id, { title: 'Moved standup', start: '2031-09-15T10:00:00Z', end: '2031-09-15T10:30:00Z' }, 'following')
  assert.equal(status, 200)
  assert.ok(body.event.recurringEventId !== seriesId, 'a new series should be created')

  const after = await allInstances()
  const remaining = after.filter((e) => e.recurringEventId === seriesId)
  // Occurrences 1 and 2 stay in the original series, unedited.
  assert.deepEqual(
    remaining.map((e) => e.originalStart),
    ['2031-09-01T09:00:00.000Z', '2031-09-08T09:00:00.000Z'],
  )
  // The new series owns the split point and everything after it.
  const next = after.filter((e) => e.recurringEventId === body.event.recurringEventId)
  assert.equal(next.length, 2)
  assert.equal(next[0].title, 'Moved standup')
  assert.equal(next[0].start, '2031-09-15T10:00:00.000Z')

  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
  await call(`/api/events/${body.event.recurringEventId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

test('scope=following on the first occurrence is the whole series', async () => {
  const seriesId = await bookSeries()
  const before = await instances(seriesId)
  const target = before.find((e) => e.originalStart === '2031-09-01T09:00:00.000Z')

  const { status, body } = await patch(target.id, { title: 'All new' }, 'following')
  assert.equal(status, 200)
  assert.equal(body.event.id, seriesId, 'editing from the first occurrence keeps the series id')

  const after = await instances(seriesId)
  assert.equal(after.every((e) => e.title === 'All new'), true)

  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

test('scope=following truncates the series when deleting', async () => {
  const seriesId = await bookSeries()
  const before = await instances(seriesId)
  const target = before.find((e) => e.originalStart === '2031-09-15T09:00:00.000Z')

  const { status } = await call(`/api/events/${target.id}?provider=local&calendarId=work&scope=following`, {
    method: 'DELETE',
    headers: KEY,
  })
  assert.equal(status, 200)

  const after = await instances(seriesId)
  assert.deepEqual(
    after.map((e) => e.originalStart),
    ['2031-09-01T09:00:00.000Z', '2031-09-08T09:00:00.000Z'],
    'the third occurrence onwards must be gone',
  )

  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('an invalid scope is rejected', async () => {
  const seriesId = await bookSeries()
  const { status, body } = await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=bogus`, {
    method: 'DELETE',
    headers: KEY,
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'bad_request')
  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

test('scope=following without an instance id is rejected', async () => {
  const seriesId = await bookSeries()
  const { status, body } = await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=following`, {
    method: 'DELETE',
    headers: KEY,
  })
  assert.equal(status, 400)
  assert.match(body.error.message, /instance id/i)
  await call(`/api/events/${seriesId}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
})

test('a plain event ignores scope and still works', async () => {
  const { status, body } = await call('/api/book', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', title: 'One-off', start: '2031-09-01T14:00:00Z', end: '2031-09-01T15:00:00Z' }),
  })
  assert.equal(status, 201)
  const id = body.event.id
  const patched = await patch(id, {}, 'all')
  assert.equal(patched.status, 200)
  const deleted = await call(`/api/events/${id}?provider=local&calendarId=work&scope=this`, { method: 'DELETE', headers: KEY })
  assert.equal(deleted.status, 200)
})
