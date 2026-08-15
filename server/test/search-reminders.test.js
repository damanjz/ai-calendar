import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-search-'))
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

async function book(overrides = {}) {
  return call('/api/book', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({
      provider: 'local',
      calendarId: 'work',
      title: 'Team sync',
      start: '2031-09-01T09:00:00Z',
      end: '2031-09-01T09:30:00Z',
      ...overrides,
    }),
  })
}

async function wipe() {
  const listed = await call('/api/events?provider=local&calendarId=work&from=2031-01-01T00:00:00Z&to=2032-01-01T00:00:00Z', { headers: KEY })
  const ids = new Set(listed.body.events.map((e) => e.recurringEventId).filter(Boolean))
  for (const id of ids) {
    await call(`/api/events/${id}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
  }
  for (const e of listed.body.events) {
    if (!e.recurringEventId) {
      await call(`/api/events/${e.id}?provider=local&calendarId=work`, { method: 'DELETE', headers: KEY })
    }
  }
}

// ---------------------------------------------------------------------------
// Category + reminders validation
// ---------------------------------------------------------------------------

test('book accepts category and reminders and stores them', async () => {
  const { status, body } = await book({ title: 'Retro', category: 'team', reminders: [15, 60] })
  assert.equal(status, 201)
  assert.equal(body.event.category, 'team')
  assert.deepEqual(body.event.reminders, [60, 15])
  await wipe()
})

test('book rejects malformed reminders', async () => {
  const badType = await book({ reminders: 'soon' })
  assert.equal(badType.status, 400)
  const badValue = await book({ reminders: [-5] })
  assert.equal(badValue.status, 400)
  assert.match(badValue.body.error.message, /non-negative/)
  const dupes = await book({ reminders: [5, 5] })
  assert.equal(dupes.status, 400)
  assert.match(dupes.body.error.message, /distinct/)
  const tooMany = await book({ reminders: Array.from({ length: 11 }, (_, i) => i) })
  assert.equal(tooMany.status, 400)
  assert.match(tooMany.body.error.message, /10/)
})

test('book rejects an over-long category', async () => {
  const { status } = await book({ category: 'x'.repeat(51) })
  assert.equal(status, 400)
})

// ---------------------------------------------------------------------------
// Search (?q=)
// ---------------------------------------------------------------------------

test('search matches title, description, location, and category, case-insensitively', async () => {
  await book({ title: 'Quarterly planning', description: 'with the exec team', location: 'Boardroom', category: 'exec' })
  await book({ title: 'One-on-one', description: 'catch up with Sam', location: 'Cafe', category: 'personal' })

  const byTitle = await call('/api/events?provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z&q=quarterly', { headers: KEY })
  assert.equal(byTitle.body.count, 1)
  assert.equal(byTitle.body.events[0].title, 'Quarterly planning')

  const byDesc = await call('/api/events?provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z&q=sam', { headers: KEY })
  assert.equal(byDesc.body.count, 1)
  assert.equal(byDesc.body.events[0].title, 'One-on-one')

  const byCat = await call('/api/events?provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z&q=exec', { headers: KEY })
  assert.equal(byCat.body.count, 1)

  const byLocation = await call('/api/events?provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z&q=cafe', { headers: KEY })
  assert.equal(byLocation.body.count, 1)

  const none = await call('/api/events?provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z&q=zzz', { headers: KEY })
  assert.equal(none.body.count, 0)

  await wipe()
})

// ---------------------------------------------------------------------------
// /api/reminders
// ---------------------------------------------------------------------------

test('reminders endpoint lists events whose triggers fall in the window', async () => {
  // 09:00 event with a 15-minute reminder -> trigger at 08:45.
  await book({ title: 'Standup', reminders: [15] })
  // 09:00 event with a 60-minute reminder -> trigger at 08:00 (outside 08:30+ window).
  await book({ title: 'Deep work', reminders: [60] })

  const due = await call('/api/reminders?provider=local&calendarId=work&from=2031-09-01T08:30:00Z&to=2031-09-01T09:30:00Z', { headers: KEY })
  assert.equal(due.status, 200)
  assert.equal(due.body.count, 1)
  assert.equal(due.body.reminders[0].title, 'Standup')
  assert.equal(due.body.reminders[0].reminders[0], '2031-09-01T08:45:00.000Z')

  const all = await call('/api/reminders?provider=local&calendarId=work&from=2031-09-01T07:00:00Z&to=2031-09-01T09:30:00Z', { headers: KEY })
  assert.equal(all.body.count, 2)

  await wipe()
})

test('events without reminders never appear in /api/reminders', async () => {
  await book({ title: 'No reminder' })
  const due = await call('/api/reminders?provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-02T00:00:00Z', { headers: KEY })
  assert.equal(due.body.count, 0)
  await wipe()
})

test('a recurring event contributes reminders for each occurrence', async () => {
  await book({
    title: 'Weekly reminder',
    start: '2031-09-01T09:00:00Z',
    end: '2031-09-01T09:30:00Z',
    recurrence: 'RRULE:FREQ=WEEKLY;COUNT=3',
    reminders: [30],
  })
  // Occurrences Sep 1, 8, 15 at 09:00 -> triggers at 08:30 those days.
  const due = await call('/api/reminders?provider=local&calendarId=work&from=2031-09-01T00:00:00Z&to=2031-09-30T00:00:00Z', { headers: KEY })
  assert.equal(due.body.count, 3)
  assert.deepEqual(
    due.body.reminders.map((r) => r.reminders[0]),
    ['2031-09-01T08:30:00.000Z', '2031-09-08T08:30:00.000Z', '2031-09-15T08:30:00.000Z'],
  )
  await wipe()
})
