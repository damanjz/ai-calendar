import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-google-'))
process.env.DATA_DIR = TMP

const { default: GoogleProvider } = await import('../src/providers/google.js')
const { saveTokens } = await import('../src/auth/store.js')

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const CFG = {
  enabled: true,
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:3000/api/auth/google/callback',
}

const VALID = { access_token: 'tok', refresh_token: 'r', expiry_date: Date.now() + 3_600_000 }

/**
 * A GoogleProvider whose `client()` resolves to a fake Calendar API.
 * `client()` itself is left intact up to the token check so the refresh and
 * "not authenticated" paths stay under test.
 */
function providerWith(api, { tokens = VALID } = {}) {
  saveTokens('google', tokens)
  const p = new GoogleProvider(CFG)
  p.client = async () => {
    const stored = (await import('../src/auth/store.js')).loadTokens('google')
    if (!stored) throw new Error('no tokens')
    return api
  }
  return p
}

const GOOGLE_EVENT = {
  id: 'evt-1',
  summary: 'Standup',
  description: 'Daily',
  location: 'Room 2',
  start: { dateTime: '2031-06-02T09:00:00Z' },
  end: { dateTime: '2031-06-02T09:15:00Z' },
  attendees: [{ email: 'sam@example.com' }],
}

test('google: isConfigured / isReady reflect credentials and tokens', () => {
  assert.equal(new GoogleProvider({ enabled: false }).isConfigured(), false)
  assert.equal(new GoogleProvider({ ...CFG, clientSecret: '' }).isConfigured(), false)

  saveTokens('google', null)
  assert.equal(new GoogleProvider(CFG).isReady(), false, 'configured but unauthenticated')

  saveTokens('google', VALID)
  assert.equal(new GoogleProvider(CFG).isReady(), true)
})

test('google: authUrl requests offline access for the calendar scope', () => {
  const url = new URL(new GoogleProvider(CFG).authUrl('state-abc'))
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('state'), 'state-abc')
  assert.match(url.searchParams.get('scope'), /calendar\.events/)
})

test('google: oauth() refuses when unconfigured', () => {
  assert.throws(() => new GoogleProvider({ enabled: false }).oauth(), (e) => e.code === 'bad_request')
})

test('google: client() refuses when no token is stored', async () => {
  saveTokens('google', null)
  const p = new GoogleProvider(CFG)
  await assert.rejects(() => p.client(), (e) => e.code === 'bad_request')
})

// The bug this file exists for: every call site must await client() before
// touching .events / .calendarList, or it dereferences a pending Promise.
test('google: getCalendars awaits the client and maps the list', async () => {
  const p = providerWith({
    calendarList: {
      list: async () => ({
        data: { items: [{ id: 'primary', summary: 'Work', primary: true }, { id: 'other', summary: 'Home' }] },
      }),
    },
  })
  const calendars = await p.getCalendars()
  assert.deepEqual(calendars, [
    { id: 'primary', name: 'Work', primary: true },
    { id: 'other', name: 'Home', primary: false },
  ])
})

test('google: getEvents normalises and defaults to the primary calendar', async () => {
  let received
  const p = providerWith({
    events: {
      list: async (args) => {
        received = args
        return { data: { items: [GOOGLE_EVENT] } }
      },
    },
  })

  const events = await p.getEvents({ from: '2031-06-02T00:00:00Z', to: '2031-06-03T00:00:00Z' })
  assert.equal(received.calendarId, 'primary', 'omitted calendarId must fall back to primary')
  assert.equal(received.singleEvents, true, 'recurring events must be expanded')
  assert.deepEqual(events[0], {
    id: 'evt-1',
    provider: 'google',
    calendarId: null,
    title: 'Standup',
    description: 'Daily',
    location: 'Room 2',
    start: '2031-06-02T09:00:00Z',
    end: '2031-06-02T09:15:00Z',
    allDay: false,
    attendees: ['sam@example.com'],
  })
})

test('google: an all-day event is flagged', async () => {
  const p = providerWith({
    events: {
      list: async () => ({
        data: { items: [{ id: 'a', summary: 'Holiday', start: { date: '2031-06-02' }, end: { date: '2031-06-03' } }] },
      }),
    },
  })
  const [event] = await p.getEvents({ from: '2031-06-01T00:00:00Z', to: '2031-06-04T00:00:00Z' })
  assert.equal(event.allDay, true)
  assert.equal(event.start, '2031-06-02')
})

test('google: an empty items list does not throw', async () => {
  const p = providerWith({ events: { list: async () => ({ data: {} }) } })
  assert.deepEqual(await p.getEvents({ from: '2031-06-02T00:00:00Z', to: '2031-06-03T00:00:00Z' }), [])
})

test('google: createEvent sends a Google body and returns the normalized event', async () => {
  let sent
  const p = providerWith({
    events: {
      insert: async (args) => {
        sent = args
        return { data: { ...GOOGLE_EVENT, id: 'new-1' } }
      },
    },
  })

  const created = await p.createEvent({
    calendarId: 'primary',
    event: {
      title: 'Coffee',
      description: 'chat',
      location: 'Blue Bottle',
      attendees: ['sam@example.com'],
      start: '2031-06-02T14:00:00Z',
      end: '2031-06-02T14:30:00Z',
    },
  })

  assert.equal(sent.requestBody.summary, 'Coffee')
  assert.equal(sent.requestBody.start.dateTime, '2031-06-02T14:00:00.000Z')
  assert.deepEqual(sent.requestBody.attendees, [{ email: 'sam@example.com' }])
  assert.equal(created.id, 'new-1')
  assert.equal(created.provider, 'google')
})

test('google: updateEvent and deleteEvent reach the API', async () => {
  const seen = []
  const p = providerWith({
    events: {
      update: async (args) => {
        seen.push(['update', args.eventId])
        return { data: { ...GOOGLE_EVENT, summary: 'Renamed' } }
      },
      delete: async (args) => {
        seen.push(['delete', args.eventId])
      },
    },
  })

  const updated = await p.updateEvent({
    calendarId: 'primary',
    eventId: 'evt-1',
    event: { title: 'Renamed', start: '2031-06-02T09:00:00Z', end: '2031-06-02T09:30:00Z' },
  })
  assert.equal(updated.title, 'Renamed')

  assert.deepEqual(await p.deleteEvent({ calendarId: 'primary', eventId: 'evt-1' }), { deleted: true })
  assert.deepEqual(seen, [['update', 'evt-1'], ['delete', 'evt-1']])
})

test('google: upstream failures become provider_error on every method', async () => {
  const boom = async () => {
    throw new Error('quota exceeded')
  }
  const p = providerWith({
    calendarList: { list: boom },
    events: { list: boom, insert: boom, update: boom, delete: boom },
  })

  const isProviderError = (e) => e.code === 'provider_error' && e.status === 502
  const event = { title: 'x', start: '2031-06-02T09:00:00Z', end: '2031-06-02T09:30:00Z' }

  await assert.rejects(() => p.getCalendars(), isProviderError)
  await assert.rejects(() => p.getEvents({ from: '2031-06-02T00:00:00Z', to: '2031-06-03T00:00:00Z' }), isProviderError)
  await assert.rejects(() => p.createEvent({ calendarId: 'primary', event }), isProviderError)
  await assert.rejects(() => p.updateEvent({ calendarId: 'primary', eventId: 'e', event }), isProviderError)
  await assert.rejects(() => p.deleteEvent({ calendarId: 'primary', eventId: 'e' }), isProviderError)
})

test('google: an ApiError from the auth layer is not masked as provider_error', async () => {
  saveTokens('google', null)
  const p = new GoogleProvider(CFG)
  // client() throws bad_request; wrap() must pass ApiError through untouched.
  await assert.rejects(() => p.getCalendars(), (e) => e.code === 'bad_request')
})
