import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The local provider and fs-store resolve DATA_DIR at import time, so point it
// at a scratch dir before importing anything that touches disk.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-test-'))
process.env.DATA_DIR = TMP

const { default: LocalProvider } = await import('../src/providers/local.js')
const { default: CalendarProvider } = await import('../src/providers/base.js')
const { default: GoogleProvider } = await import('../src/providers/google.js')
const { default: OutlookProvider } = await import('../src/providers/outlook.js')
const { default: CalDavProvider } = await import('../src/providers/caldav.js')

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

// node:test runs tests concurrently, so a shared store file would let one test
// see another's events. Give each provider its own isolated store path.
let storeCounter = 0
function freshProvider() {
  const p = new LocalProvider()
  const file = path.join(TMP, `store-${storeCounter++}.json`)
  p.load = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  p.save = (store) => fs.writeFileSync(file, JSON.stringify(store, null, 2))
  p.save({
    calendars: [
      { id: 'work', name: 'Work', primary: true },
      { id: 'personal', name: 'Personal', primary: false },
    ],
    events: [],
  })
  return p
}

const EVENT = {
  title: 'Team sync',
  description: '',
  location: '',
  attendees: [],
  allDay: false,
  start: '2030-03-01T09:00:00.000Z',
  end: '2030-03-01T09:30:00.000Z',
}

// ---------------------------------------------------------------------------
// Provider contract — every provider must implement the same five methods
// ---------------------------------------------------------------------------

test('every provider implements the five-method contract', () => {
  const providers = [
    new LocalProvider(),
    new GoogleProvider({ enabled: false }),
    new OutlookProvider({ enabled: false }),
    new CalDavProvider({ enabled: false }),
  ]
  for (const p of providers) {
    for (const method of ['getCalendars', 'getEvents', 'createEvent', 'updateEvent', 'deleteEvent']) {
      assert.equal(typeof p[method], 'function', `${p.id} is missing ${method}`)
      assert.notEqual(
        p[method],
        CalendarProvider.prototype[method],
        `${p.id}.${method} must override the base stub`,
      )
    }
    assert.equal(typeof p.isConfigured(), 'boolean')
    assert.equal(typeof p.isReady(), 'boolean')
  }
})

test('base provider stubs reject rather than silently returning undefined', async () => {
  const base = new CalendarProvider('base', 'Base')
  for (const method of ['getCalendars', 'getEvents', 'createEvent', 'updateEvent', 'deleteEvent']) {
    await assert.rejects(() => base[method]({}), /not implemented/, `${method} should reject`)
  }
})

// Regression guard for the bug where `await this.calendar().events.list()` read
// `.events` off a pending Promise and threw before the await resolved.
test('Google provider never dereferences an un-awaited client', () => {
  const raw = fs.readFileSync(new URL('../src/providers/google.js', import.meta.url), 'utf8')
  // Strip comments so the cautionary note in the docstring isn't mistaken for code.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(
    src,
    /this\.client\(\)\s*\./,
    'this.client() must be awaited into a variable before property access',
  )
  assert.doesNotMatch(src, /this\.calendar\(\)\s*\./, 'stale un-awaited calendar() call site')
})

// ---------------------------------------------------------------------------
// Local provider — full CRUD lifecycle
// ---------------------------------------------------------------------------

test('local provider: seeds two calendars with a primary', async () => {
  const p = freshProvider()
  const calendars = await p.getCalendars()
  assert.equal(calendars.length, 2)
  assert.equal(calendars.filter((c) => c.primary).length, 1)
})

test('local provider: book → read → update → delete lifecycle', async () => {
  const p = freshProvider()

  const created = await p.createEvent({ calendarId: 'work', event: EVENT })
  assert.ok(created.id)
  assert.equal(created.provider, 'local')
  assert.equal(created.calendarId, 'work')

  const found = await p.getEvents({ from: '2030-03-01T00:00:00Z', to: '2030-03-02T00:00:00Z' })
  assert.equal(found.length, 1)
  assert.equal(found[0].title, 'Team sync')

  const updated = await p.updateEvent({
    eventId: created.id,
    event: { ...EVENT, title: 'Renamed', start: '2030-03-01T10:00:00.000Z', end: '2030-03-01T10:30:00.000Z' },
  })
  assert.equal(updated.id, created.id, 'update must preserve the id')
  assert.equal(updated.title, 'Renamed')

  const del = await p.deleteEvent({ eventId: created.id })
  assert.deepEqual(del, { deleted: true })
  assert.equal((await p.getEvents({ from: '2030-03-01T00:00:00Z', to: '2030-03-02T00:00:00Z' })).length, 0)
})

test('local provider: rejects booking into a non-existent calendar', async () => {
  const p = freshProvider()
  await assert.rejects(
    () => p.createEvent({ calendarId: 'does-not-exist', event: EVENT }),
    (e) => e.code === 'bad_request',
  )
})

test('local provider: update / delete of an unknown id is not_found', async () => {
  const p = freshProvider()
  await assert.rejects(() => p.updateEvent({ eventId: 'nope', event: EVENT }), (e) => e.code === 'not_found')
  await assert.rejects(() => p.deleteEvent({ eventId: 'nope' }), (e) => e.code === 'not_found')
})

test('local provider: getEvents filters by window and by calendarId', async () => {
  const p = freshProvider()
  await p.createEvent({ calendarId: 'work', event: EVENT })
  await p.createEvent({
    calendarId: 'personal',
    event: { ...EVENT, title: 'Gym', start: '2030-03-05T18:00:00.000Z', end: '2030-03-05T19:00:00.000Z' },
  })

  const workOnly = await p.getEvents({ calendarId: 'work', from: '2030-03-01T00:00:00Z', to: '2030-03-10T00:00:00Z' })
  assert.deepEqual(workOnly.map((e) => e.title), ['Team sync'])

  const narrow = await p.getEvents({ from: '2030-03-04T00:00:00Z', to: '2030-03-06T00:00:00Z' })
  assert.deepEqual(narrow.map((e) => e.title), ['Gym'])

  const all = await p.getEvents({ from: '2030-03-01T00:00:00Z', to: '2030-03-10T00:00:00Z' })
  assert.equal(all.length, 2)
})

test('local provider: an event touching the window edge is excluded', async () => {
  const p = freshProvider()
  await p.createEvent({ calendarId: 'work', event: EVENT }) // 09:00–09:30
  // Window starts exactly when the event ends -> half-open, so no match.
  const after = await p.getEvents({ from: '2030-03-01T09:30:00Z', to: '2030-03-01T10:00:00Z' })
  assert.equal(after.length, 0)
})

// ---------------------------------------------------------------------------
// getAvailability delegation (inherited from base)
// ---------------------------------------------------------------------------

test('local provider: getAvailability excludes booked time and tags each slot', async () => {
  const p = freshProvider()
  await p.createEvent({ calendarId: 'work', event: EVENT }) // 09:00–09:30

  const slots = await p.getAvailability({
    from: '2030-03-01T09:00:00Z',
    to: '2030-03-01T10:30:00Z',
    duration: 30,
    granularity: 30,
  })
  assert.deepEqual(slots.map((s) => s.start), ['2030-03-01T09:30:00.000Z', '2030-03-01T10:00:00.000Z'])
  for (const s of slots) {
    assert.equal(s.provider, 'local')
    assert.equal(s.duration, 30)
  }
})

test('local provider: availability and conflicts agree across calendars', async () => {
  const p = freshProvider()
  await p.createEvent({ calendarId: 'work', event: { ...EVENT, start: '2030-03-01T09:00:00.000Z', end: '2030-03-01T17:00:00.000Z' } })

  // Busy on "work" ...
  const workSlots = await p.getAvailability({
    calendarId: 'work', from: '2030-03-01T11:00:00Z', to: '2030-03-01T13:00:00Z', duration: 30, granularity: 30,
  })
  assert.equal(workSlots.length, 0)

  // ... but free on "personal".
  const personalSlots = await p.getAvailability({
    calendarId: 'personal', from: '2030-03-01T11:00:00Z', to: '2030-03-01T13:00:00Z', duration: 30, granularity: 30,
  })
  assert.ok(personalSlots.length > 0)
})

// ---------------------------------------------------------------------------
// Unconfigured providers report themselves honestly
// ---------------------------------------------------------------------------

test('unconfigured providers are neither configured nor ready', () => {
  assert.equal(new GoogleProvider({ enabled: false }).isConfigured(), false)
  assert.equal(new GoogleProvider({ enabled: true, clientId: '', clientSecret: '' }).isConfigured(), false)
  assert.equal(new OutlookProvider({ enabled: false }).isReady(), false)
  assert.equal(new CalDavProvider({ enabled: true, baseUrl: '', username: '', password: '' }).isConfigured(), false)
  assert.equal(
    new CalDavProvider({ enabled: true, baseUrl: 'https://x/', username: 'u', password: 'p' }).isConfigured(),
    true,
  )
})

test('CalDAV: parses a comma-separated URL list into calendars', async () => {
  const p = new CalDavProvider({
    enabled: true, baseUrl: 'https://x.test/dav/work/, https://x.test/dav/home/', username: 'u', password: 'p',
  })
  const calendars = await p.getCalendars()
  assert.deepEqual(calendars.map((c) => c.name), ['work', 'home'])
  assert.equal(calendars[0].primary, true)
})

test('CalDAV: escapes ICS special characters so the payload cannot be broken', () => {
  const p = new CalDavProvider({ enabled: true, baseUrl: 'https://x/', username: 'u', password: 'p' })
  const ics = p.toIcs({ ...EVENT, title: 'Lunch; with, Sam\nand others', description: '', location: '' }, 'uid-1')
  assert.match(ics, /SUMMARY:Lunch\\; with\\, Sam\\nand others/)
  assert.match(ics, /^BEGIN:VCALENDAR/)
  assert.match(ics, /END:VCALENDAR\r\n$/)
})
