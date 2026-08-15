import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated token storage: these tests write fake OAuth tokens.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-remote-'))
process.env.DATA_DIR = TMP

const { default: OutlookProvider } = await import('../src/providers/outlook.js')
const { default: CalDavProvider } = await import('../src/providers/caldav.js')
const { saveTokens } = await import('../src/auth/store.js')

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const OUTLOOK_CFG = {
  enabled: true,
  tenant: 'common',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:3000/api/auth/outlook/callback',
}

/** Installs a fake global fetch, returns the captured calls, restores on cleanup. */
function stubFetch(t, handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return handler(String(url), options)
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// ---------------------------------------------------------------------------
// Outlook / Microsoft Graph
// ---------------------------------------------------------------------------

test('outlook: authUrl carries the required OAuth parameters', () => {
  const p = new OutlookProvider(OUTLOOK_CFG)
  const url = new URL(p.authUrl('state-123'))
  assert.equal(url.searchParams.get('client_id'), 'client-id')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('state'), 'state-123')
  assert.match(url.searchParams.get('scope'), /Calendars\.ReadWrite/)
})

test('outlook: authUrl refuses when unconfigured', () => {
  const p = new OutlookProvider({ enabled: false })
  assert.throws(() => p.authUrl('s'), (e) => e.code === 'bad_request')
})

test('outlook: getEvents normalises Graph payloads', async (t) => {
  saveTokens('outlook', { access_token: 'tok', expires_at: Date.now() + 3_600_000 })
  const p = new OutlookProvider(OUTLOOK_CFG)

  const calls = stubFetch(t, () =>
    jsonResponse({
      value: [
        {
          id: 'evt-1',
          subject: 'Standup',
          bodyPreview: 'Daily',
          location: { displayName: 'Room 2' },
          start: { dateTime: '2031-06-02T09:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2031-06-02T09:15:00.0000000', timeZone: 'UTC' },
          attendees: [{ emailAddress: { address: 'sam@example.com' } }],
          allDay: false,
        },
      ],
    }),
  )

  const events = await p.getEvents({ from: '2031-06-02T00:00:00Z', to: '2031-06-03T00:00:00Z' })
  assert.equal(events.length, 1)
  assert.deepEqual(
    { ...events[0] },
    {
      id: 'evt-1',
      provider: 'outlook',
      calendarId: null,
      title: 'Standup',
      description: 'Daily',
      location: 'Room 2',
      start: '2031-06-02T09:00:00.0000000',
      end: '2031-06-02T09:15:00.0000000',
      allDay: false,
      attendees: ['sam@example.com'],
    },
  )
  assert.match(calls[0].url, /graph\.microsoft\.com/)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok')
})

test('outlook: a Graph error becomes provider_error, not a raw throw', async (t) => {
  saveTokens('outlook', { access_token: 'tok', expires_at: Date.now() + 3_600_000 })
  const p = new OutlookProvider(OUTLOOK_CFG)
  stubFetch(t, () => new Response('upstream exploded', { status: 503 }))

  await assert.rejects(
    () => p.getCalendars(),
    (e) => e.code === 'provider_error' && e.status === 502,
  )
})

test('outlook: an expired token triggers a refresh before the request', async (t) => {
  saveTokens('outlook', {
    access_token: 'stale',
    refresh_token: 'refresh-me',
    expires_at: Date.now() - 1000,
  })
  const p = new OutlookProvider(OUTLOOK_CFG)

  const calls = stubFetch(t, (url) => {
    if (url.includes('/token')) {
      return jsonResponse({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 })
    }
    return jsonResponse({ value: [] })
  })

  await p.getCalendars()
  assert.match(calls[0].url, /oauth2\/v2\.0\/token$/, 'refresh must happen first')
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fresh', 'must use the refreshed token')
})

test('outlook: refuses to act when no token is stored', async () => {
  saveTokens('outlook', null)
  const p = new OutlookProvider(OUTLOOK_CFG)
  await assert.rejects(() => p.getCalendars(), (e) => e.code === 'bad_request')
})

test('outlook: builds a Graph event body from the normalized shape', () => {
  const p = new OutlookProvider(OUTLOOK_CFG)
  const body = p.toGraphEvent({
    title: 'Coffee',
    description: 'chat',
    location: 'Blue Bottle',
    start: '2031-06-02T14:00:00Z',
    end: '2031-06-02T14:30:00Z',
    attendees: ['sam@example.com'],
  })
  assert.equal(body.subject, 'Coffee')
  assert.equal(body.start.timeZone, 'UTC')
  assert.equal(body.start.dateTime, '2031-06-02T14:00:00.000Z')
  assert.deepEqual(body.attendees, [
    { emailAddress: { address: 'sam@example.com' }, type: 'required' },
  ])
})

// ---------------------------------------------------------------------------
// CalDAV
// ---------------------------------------------------------------------------

const CALDAV_CFG = {
  enabled: true,
  baseUrl: 'https://dav.test/calendars/me/work/',
  username: 'user',
  password: 'pass',
}

test('caldav: basic auth header is correctly encoded', () => {
  const p = new CalDavProvider(CALDAV_CFG)
  assert.equal(p.basicAuth(), 'Basic ' + Buffer.from('user:pass').toString('base64'))
})

test('caldav: createEvent PUTs an ICS document and returns the new id', async (t) => {
  const p = new CalDavProvider(CALDAV_CFG)
  const calls = stubFetch(t, () => new Response('', { status: 201 }))

  const created = await p.createEvent({
    calendarId: 'https://dav.test/calendars/me/work/',
    event: {
      title: 'Team sync',
      description: '',
      location: '',
      attendees: [],
      start: '2031-06-02T09:00:00.000Z',
      end: '2031-06-02T09:30:00.000Z',
    },
  })

  assert.ok(created.id)
  assert.equal(created.provider, 'caldav')
  assert.equal(calls[0].options.method, 'PUT')
  assert.match(calls[0].url, /\.ics$/)
  assert.match(calls[0].options.body, /BEGIN:VEVENT/)
  assert.match(calls[0].options.body, /SUMMARY:Team sync/)
})

test('caldav: a failed write surfaces as provider_error', async (t) => {
  const p = new CalDavProvider(CALDAV_CFG)
  stubFetch(t, () => new Response('', { status: 403 }))
  await assert.rejects(
    () => p.createEvent({ event: { title: 'x', start: '2031-06-02T09:00:00Z', end: '2031-06-02T09:30:00Z' } }),
    (e) => e.code === 'provider_error',
  )
})

test('caldav: deleting an already-absent event is treated as success', async (t) => {
  const p = new CalDavProvider(CALDAV_CFG)
  stubFetch(t, () => new Response('', { status: 404 }))
  assert.deepEqual(await p.deleteEvent({ eventId: 'gone' }), { deleted: true })
})

test('caldav: updateEvent requires an eventId', async () => {
  const p = new CalDavProvider(CALDAV_CFG)
  await assert.rejects(
    () => p.updateEvent({ eventId: '', event: { title: 'x' } }),
    (e) => e.code === 'bad_request',
  )
})

test('caldav: ICS output uses CRLF line endings as the spec requires', () => {
  const p = new CalDavProvider(CALDAV_CFG)
  const ics = p.toIcs(
    { title: 'X', description: '', location: '', attendees: [], start: '2031-06-02T09:00:00Z', end: '2031-06-02T09:30:00Z' },
    'uid',
  )
  const lines = ics.split('\r\n')
  assert.equal(lines[0], 'BEGIN:VCALENDAR')
  assert.ok(lines.includes('END:VEVENT'))
  assert.doesNotMatch(ics, /[^\r]\n/, 'every newline must be preceded by a carriage return')
})
