import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-recur-'))
process.env.DATA_DIR = TMP

const { default: LocalProvider } = await import('../src/providers/local.js')
const { default: GoogleProvider } = await import('../src/providers/google.js')
const { default: OutlookProvider } = await import('../src/providers/outlook.js')
const { default: CalDavProvider } = await import('../src/providers/caldav.js')
const { saveTokens } = await import('../src/auth/store.js')

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

let storeCounter = 0
function freshProvider(events = []) {
  const p = new LocalProvider()
  const file = path.join(TMP, `store-${storeCounter++}.json`)
  p.load = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  p.save = (store) => fs.writeFileSync(file, JSON.stringify(store, null, 2))
  p.save({
    calendars: [{ id: 'work', name: 'Work', primary: true }],
    events,
  })
  return p
}

const WEEKLY = {
  id: 'series-1',
  calendarId: 'work',
  title: 'Standup',
  description: '',
  location: '',
  attendees: [],
  allDay: false,
  start: '2031-06-02T09:00:00.000Z',
  end: '2031-06-02T09:15:00.000Z',
  recurrence: 'RRULE:FREQ=WEEKLY',
}

// ---------------------------------------------------------------------------
// local provider
// ---------------------------------------------------------------------------

test('local: a recurring event is returned expanded, not as a master', async () => {
  const p = freshProvider([WEEKLY])
  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })

  assert.ok(events.length >= 4, `expected weekly occurrences, got ${events.length}`)
  for (const e of events) {
    assert.equal(e.recurringEventId, 'series-1')
    assert.equal(e.recurrence, undefined, 'instances must not carry the rule')
    assert.equal(e.provider, 'local')
  }
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, 'ids must be unique')
})

test('local: a series starting BEFORE the window still blocks time in it', async () => {
  // The regression this feature exists to prevent.
  const old = { ...WEEKLY, start: '2030-01-07T09:00:00.000Z', end: '2030-01-07T09:15:00.000Z' }
  const p = freshProvider([old])
  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })
  assert.ok(events.length >= 4, 'an old weekly series must still appear in a later window')
})

test('local: availability does not offer a slot held by a later occurrence', async () => {
  const p = freshProvider([WEEKLY])
  const slots = await p.getAvailability({
    from: '2031-06-16T09:00:00Z', // the THIRD occurrence
    to: '2031-06-16T10:00:00Z',
    duration: 15,
    granularity: 15,
  })
  assert.equal(
    slots.some((s) => s.start === '2031-06-16T09:00:00.000Z'),
    false,
    'the recurring standup must block its own slot',
  )
  assert.ok(slots.length > 0, 'the rest of the hour should still be free')
})

test('local: a non-recurring event is unaffected', async () => {
  const plain = { ...WEEKLY, id: 'solo', recurrence: undefined }
  delete plain.recurrence
  const p = freshProvider([plain])
  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })
  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'solo')
  assert.equal(events[0].recurringEventId, undefined)
})

test('local: booking a recurring event persists the rule and it expands on read', async () => {
  const p = freshProvider()
  const created = await p.createEvent({
    calendarId: 'work',
    event: { ...WEEKLY, id: undefined, recurrence: 'RRULE:FREQ=DAILY;COUNT=3' },
  })
  assert.equal(created.recurrence, 'RRULE:FREQ=DAILY;COUNT=3', 'the rule must be stored')

  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-10T00:00:00Z' })
  assert.equal(events.length, 3)
  assert.deepEqual(events.map((e) => e.start.slice(0, 10)), ['2031-06-02', '2031-06-03', '2031-06-04'])
})

// ---------------------------------------------------------------------------
// google — already expanded upstream via singleEvents:true
// ---------------------------------------------------------------------------

test('google: requests server-side expansion and links instances to their series', async () => {
  saveTokens('google', { access_token: 't', expiry_date: Date.now() + 3_600_000 })
  const p = new GoogleProvider({ enabled: true, clientId: 'c', clientSecret: 's' })
  let args
  p.client = async () => ({
    events: {
      list: async (a) => {
        args = a
        return {
          data: {
            items: [
              {
                id: 'master_20310609T090000Z',
                summary: 'Standup',
                start: { dateTime: '2031-06-09T09:00:00Z' },
                end: { dateTime: '2031-06-09T09:15:00Z' },
                recurringEventId: 'master',
                originalStartTime: { dateTime: '2031-06-09T09:00:00Z' },
              },
            ],
          },
        }
      },
    },
  })

  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })
  assert.equal(args.singleEvents, true, 'Google must be asked to expand series')
  assert.equal(events[0].recurringEventId, 'master')
  assert.equal(events[0].originalStart, '2031-06-09T09:00:00Z')
})

// ---------------------------------------------------------------------------
// outlook — must use /calendarView, which is what expands series
// ---------------------------------------------------------------------------

test('outlook: queries calendarView (not /events) so occurrences are expanded', async (t) => {
  saveTokens('outlook', { access_token: 'tok', expires_at: Date.now() + 3_600_000 })
  const p = new OutlookProvider({ enabled: true, tenant: 'common', clientId: 'c', clientSecret: 's' })

  const seen = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    seen.push(String(url))
    return new Response(
      JSON.stringify({
        value: [
          {
            id: 'occ-1',
            subject: 'Standup',
            start: { dateTime: '2031-06-09T09:00:00.0000000' },
            end: { dateTime: '2031-06-09T09:15:00.0000000' },
            type: 'occurrence',
            seriesMasterId: 'master-1',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })

  assert.match(seen[0], /calendarView/, 'must use calendarView — /events ignores the date range')
  assert.doesNotMatch(seen[0].split('?')[0], /\/events$/)
  assert.match(seen[0], /seriesMasterId/, 'must select seriesMasterId to link instances')
  assert.equal(events[0].recurringEventId, 'master-1')
})

// ---------------------------------------------------------------------------
// caldav — node-ical parses the rule but never expands it
// ---------------------------------------------------------------------------

function icsProvider(t, ics) {
  const p = new CalDavProvider({
    enabled: true,
    baseUrl: 'https://dav.test/cal/',
    username: 'u',
    password: 'p',
  })
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(ics, { status: 200, headers: { 'Content-Type': 'text/calendar' } })
  t.after(() => {
    globalThis.fetch = original
  })
  return p
}

const RECURRING_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:standup-uid
DTSTAMP:20300101T000000Z
DTSTART:20300107T090000Z
DTEND:20300107T091500Z
RRULE:FREQ=WEEKLY
SUMMARY:Standup
END:VEVENT
END:VCALENDAR
`

test('caldav: expands a weekly series that began long before the window', async (t) => {
  const p = icsProvider(t, RECURRING_ICS)
  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })

  assert.ok(events.length >= 4, `expected expanded occurrences, got ${events.length}`)
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, 'instances must not share the master UID')
  for (const e of events) {
    assert.equal(e.recurringEventId, 'standup-uid')
    assert.ok(new Date(e.start) >= new Date('2031-06-01T00:00:00Z'))
    assert.ok(new Date(e.start) < new Date('2031-06-30T00:00:00Z'))
    assert.equal(new Date(e.end) - new Date(e.start), 15 * 60_000, 'duration must be preserved')
  }
})

test('caldav: EXDATE removes a cancelled occurrence', async (t) => {
  const withEx = RECURRING_ICS.replace('RRULE:FREQ=WEEKLY', 'RRULE:FREQ=WEEKLY\nEXDATE:20310609T090000Z')
  const p = icsProvider(t, withEx)
  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })
  assert.equal(
    events.some((e) => e.start.startsWith('2031-06-09')),
    false,
    'the cancelled occurrence must not appear',
  )
  assert.ok(events.length >= 3)
})

const PLAIN_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:standup-uid
DTSTAMP:20300101T000000Z
DTSTART:20310603T090000Z
DTEND:20310603T091500Z
SUMMARY:One-off
END:VEVENT
END:VCALENDAR
`

test('caldav: a non-recurring VEVENT is still returned normally', async (t) => {
  const p = icsProvider(t, PLAIN_ICS)
  const events = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-30T00:00:00Z' })
  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'standup-uid', 'a one-off keeps its plain UID')
  assert.equal(events[0].recurringEventId, undefined)
})
