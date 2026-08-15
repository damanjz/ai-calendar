import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Failing tests for three defects found reviewing 2351cc5.
 *
 * These are written to FAIL against the current code — they describe the
 * intended behaviour, not the present behaviour. Fix the source, not the test.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-review-'))
process.env.DATA_DIR = TMP
process.env.PROVIDERS = 'local'
delete process.env.API_KEY

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

async function call(p, options = {}) {
  const res = await fetch(base + p, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// ---------------------------------------------------------------------------
// 1. HIGH — /api/reminders misses reminders whose event is outside the window
// ---------------------------------------------------------------------------

test('reminders: a trigger inside the window is found even when the event is not', async () => {
  const created = await call('/api/book', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'local',
      calendarId: 'work',
      title: 'Dentist',
      start: '2031-06-02T10:00:00Z',
      end: '2031-06-02T11:00:00Z',
      reminders: [60],
    }),
  })
  assert.equal(created.status, 201)

  // The reminder fires at 09:00 (60 min before a 10:00 event).
  // This window contains the TRIGGER but not the EVENT.
  const { body } = await call('/api/reminders?provider=local&from=2031-06-02T08:30:00Z&to=2031-06-02T09:30:00Z')

  assert.equal(
    body.reminders.length,
    1,
    'a reminder due inside the window must be reported even though its event starts after `to` — ' +
      'the route currently fetches events using the same window as the triggers, so "what is ' +
      'coming up in the next 30 minutes?" returns nothing',
  )
  assert.equal(body.reminders[0].title, 'Dentist')
  assert.equal(body.reminders[0].reminders[0], '2031-06-02T09:00:00.000Z')

  await call(`/api/events/${created.body.event.id}?provider=local&calendarId=work`, { method: 'DELETE' })
})

// ---------------------------------------------------------------------------
// 2. MEDIUM — an oversized ICS returns 500 instead of a clean 4xx
// ---------------------------------------------------------------------------

test('import: an ICS over the 5MB limit is rejected by the route, with a specific message', async () => {
  // Must reach the route's own check (not body-parser), so the caller is told
  // it was the ICS document that was too large.
  const { status, body } = await call('/api/import/ics', {
    method: 'POST',
    body: JSON.stringify({ provider: 'local', calendarId: 'work', ics: 'X'.repeat(5_000_001) }),
  })

  assert.notEqual(status, 500, 'an oversized document must not surface as an internal server error')
  assert.equal(status, 400)
  assert.equal(body.error.code, 'bad_request')
  assert.match(body.error.message, /ICS document is too large/i)
})

test('import: a body past the JSON limit returns 413, not 500', async () => {
  // Beyond the body-parser ceiling the route never runs. That path previously
  // returned an untranslated 500 with nothing actionable.
  const { status, body } = await call('/api/import/ics', {
    method: 'POST',
    body: JSON.stringify({ provider: 'local', calendarId: 'work', ics: 'X'.repeat(8_000_000) }),
  })

  assert.equal(status, 413, 'body-parser rejections must be translated, not surfaced as 500')
  assert.equal(body.error.code, 'payload_too_large')
  assert.match(body.error.message, /too large/i)
})

// ---------------------------------------------------------------------------
// 3. MEDIUM — export asks providers for an ~8000-year window
// ---------------------------------------------------------------------------

test('export: the fallback window is bounded, not the whole epoch', async () => {
  // router.js falls back to getEvents({from:'1970-01-01', to:'9999-12-31'}) for
  // any provider without getRawEvents — i.e. google, outlook and caldav. That is
  // a ~2.9M-day full-history sweep with no pagination guard, and recurring
  // series silently truncate at the 1000-instance cap.
  const src = fs.readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
  assert.doesNotMatch(
    src,
    /9999-12-31/,
    'export must not request an unbounded window; accept from/to query params ' +
      '(defaulting to something sane) or require getRawEvents on the provider contract',
  )
})

test('export: getRawEvents is part of the provider contract, not duck-typed', async () => {
  const base = fs.readFileSync(new URL('../src/providers/base.js', import.meta.url), 'utf8')
  assert.match(
    base,
    /getRawEvents/,
    'router.js branches on `typeof provider.getRawEvents === "function"`, so export silently ' +
      'behaves differently per provider. Put it on the base contract with a documented default.',
  )
})
