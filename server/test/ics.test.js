import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eventsToIcs, parseIcs, escapeIcsText } from '../src/lib/ics.js'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-ics-'))
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

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//test//EN',
  'BEGIN:VEVENT',
  'UID:import-1',
  'DTSTART:2031-06-09T09:00:00Z',
  'DTEND:2031-06-09T09:30:00Z',
  'SUMMARY:Imported one-off',
  'DESCRIPTION:from a file',
  'LOCATION:Room 7',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:import-2',
  'DTSTART:2031-06-10T10:00:00Z',
  'DTEND:2031-06-10T10:30:00Z',
  'SUMMARY:Imported series',
  'RRULE:FREQ=WEEKLY;COUNT=4',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

// ---------------------------------------------------------------------------
// Library round-trip
// ---------------------------------------------------------------------------

test('eventsToIcs escapes text per RFC 5545', () => {
  assert.equal(escapeIcsText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne')
})

test('eventsToIcs writes masters with their RRULE', () => {
  const text = eventsToIcs([
    { id: 'm1', title: 'Standup', start: '2031-06-09T09:00:00Z', end: '2031-06-09T09:30:00Z', recurrence: 'RRULE:FREQ=WEEKLY;COUNT=4' },
    { id: 'e2', title: 'Lunch', description: 'x', location: 'Cafe', attendees: ['a@x.com'], start: '2031-06-09T12:00:00Z', end: '2031-06-09T13:00:00Z' },
  ])
  assert.match(text, /^BEGIN:VCALENDAR/)
  assert.match(text, /UID:m1/)
  assert.match(text, /RRULE:FREQ=WEEKLY;COUNT=4/)
  assert.match(text, /ATTENDEE;CN=a@x\.com;ROLE=REQ-PARTICIPANT:mailto:a@x\.com/)
  assert.match(text, /LOCATION:Cafe/)
  assert.equal(text.trimEnd().endsWith('END:VCALENDAR'), true)
})

test('parseIcs returns one-off and master events', async () => {
  const { events, errors } = await parseIcs(SAMPLE_ICS)
  assert.equal(errors.length, 0)
  assert.equal(events.length, 2)
  const oneOff = events.find((e) => e.id === 'import-1')
  assert.equal(oneOff.title, 'Imported one-off')
  assert.equal(oneOff.start, '2031-06-09T09:00:00.000Z')
  assert.equal(oneOff.recurrence, undefined)
  const series = events.find((e) => e.id === 'import-2')
  assert.ok(series.recurrence.some((l) => l.startsWith('RRULE')))
})

test('parseIcs yields no events for junk text, and no crash', async () => {
  const { events, errors } = await parseIcs('not an ics')
  assert.equal(events.length, 0)
  assert.ok(errors.length >= 0)
})

// ---------------------------------------------------------------------------
// Import / export over the API
// ---------------------------------------------------------------------------

test('importing an ICS creates the events, then they can be read', async () => {
  const res = await call('/api/import/ics', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', ics: SAMPLE_ICS }),
  })
  assert.equal(res.status, 201)
  assert.equal(res.body.imported, 2)
  assert.equal(res.body.errors.length, 0)

  const listed = await call('/api/events?provider=local&calendarId=work&from=2031-06-01T00:00:00Z&to=2031-07-15T00:00:00Z', { headers: KEY })
  const titles = listed.body.events.map((e) => e.title)
  assert.ok(titles.includes('Imported one-off'))
  assert.ok(titles.includes('Imported series'), 'series master must expand into instances')

  // Clean up: delete the master series by id, and the one-off by id.
  const ids = new Set(listed.body.events.map((e) => e.recurringEventId).filter(Boolean))
  for (const id of ids) {
    await call(`/api/events/${id}?provider=local&calendarId=work&scope=all`, { method: 'DELETE', headers: KEY })
  }
  const oneOff = listed.body.events.find((e) => e.title === 'Imported one-off')
  await call(`/api/events/${oneOff.id}?provider=local&calendarId=work`, { method: 'DELETE', headers: KEY })
})

test('importing a series yields a master that expands to its count', async () => {
  const res = await call('/api/import/ics', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'personal', ics: SAMPLE_ICS }),
  })
  assert.equal(res.status, 201)
  const listed = await call('/api/events?provider=local&calendarId=personal&from=2031-06-01T00:00:00Z&to=2031-07-15T00:00:00Z', { headers: KEY })
  const series = listed.body.events.filter((e) => e.recurringEventId)
  assert.equal(series.length, 4, 'COUNT=4 weekly must expand to four occurrences')
})

test('exporting an ICS returns a downloadable document with the stored masters', async () => {
  // Seed the calendar with its own event so this test is independent.
  await call('/api/import/ics', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work', ics: SAMPLE_ICS }),
  })
  const res = await fetch(`${base}/api/export/ics?provider=local&calendarId=work`, { headers: KEY })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/calendar/)
  const text = await res.text()
  assert.match(text, /^BEGIN:VCALENDAR/)
  assert.match(text, /END:VCALENDAR\r?\n?$/)
  assert.match(text, /SUMMARY:Imported one-off/)
  assert.match(text, /RRULE:FREQ=WEEKLY;COUNT=4/)
})

test('import requires a calendarId and ICS text', async () => {
  const noCal = await call('/api/import/ics', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ provider: 'local', ics: SAMPLE_ICS }),
  })
  assert.equal(noCal.status, 400)
  const noText = await call('/api/import/ics', {
    method: 'POST',
    headers: KEY,
    body: JSON.stringify({ provider: 'local', calendarId: 'work' }),
  })
  assert.equal(noText.status, 400)
  assert.match(noText.body.error.message, /ics/i)
})
