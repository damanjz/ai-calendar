import crypto from 'node:crypto'
import { Router } from 'express'
import config from './config.js'
import { getProvider, listProviders } from './providers/index.js'
import { parseEventBody, parseConflictBody } from './lib/validate.js'
import { requireApiKey, assertPositiveInt, parseWorkingHours } from './lib/util.js'
import { eventsToIcs, parseIcs } from './lib/ics.js'
import { badRequest, notFound } from './lib/errors.js'

export function createRouter() {
  const router = Router()

  router.use('/api', (req, res, next) => {
    try {
      requireApiKey(req, config.apiKey)
      next()
    } catch (err) {
      res.status(err.status || 401).json(err.toJSON())
    }
  })

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', providers: listProviders() })
  })

  router.get('/api/providers', (req, res) => {
    res.json({ providers: listProviders() })
  })

  router.get('/api/auth/:provider', (req, res) => {
    const provider = getProvider(req.params.provider)
    if (!provider.authUrl) {
      throw badRequest(`Provider "${req.params.provider}" does not use OAuth. It is configured via environment variables.`)
    }
    const state = req.query.state || cryptoRandom()
    res.json({ url: provider.authUrl(state), state })
  })

  router.get('/api/auth/:provider/callback', async (req, res) => {
    const provider = getProvider(req.params.provider)
    if (!provider.handleCallback) {
      throw notFound(`Provider "${req.params.provider}" has no OAuth callback.`)
    }
    const code = req.query.code
    if (!code) {
      throw badRequest(`OAuth error: ${req.query.error || 'missing code'}`)
    }
    await provider.handleCallback(code)
    res.type('text/plain').send('Authentication successful. You can close this tab and return to your assistant.')
  })

  router.get('/api/calendars', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const calendars = await provider.getCalendars()
    res.json({ provider: provider.id, calendars })
  })

  router.get('/api/events', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const from = req.query.from || startOfToday()
    const to = req.query.to || addDays(from, 7)
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw badRequest('"from" and "to" must be valid ISO 8601 date-times.')
    }
    if (new Date(to) <= new Date(from)) {
      throw badRequest('"to" must be after "from".')
    }
    const events = await provider.getEvents({
      calendarId: req.query.calendarId || undefined,
      from,
      to,
    })
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
    const filtered = q
      ? events.filter((e) =>
          [e.title, e.description, e.location, e.category].some((f) =>
            typeof f === 'string' && f.toLowerCase().includes(q),
          ),
        )
      : events
    res.json({ provider: provider.id, from, to, count: filtered.length, events: filtered })
  })

  // Events whose reminders fire within [from, to). The window defaults to the
  // next 24 hours; each event lists its trigger time(s) in ISO.
  router.get('/api/reminders', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const from = req.query.from || new Date().toISOString()
    const to = req.query.to || addDays(from, 1)
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw badRequest('"from" and "to" must be valid ISO 8601 date-times.')
    }
    if (new Date(to) <= new Date(from)) {
      throw badRequest('"to" must be after "from".')
    }
    const events = await provider.getEvents({
      calendarId: req.query.calendarId || undefined,
      from,
      to,
    })
    const fromMs = new Date(from).getTime()
    const toMs = new Date(to).getTime()
    const due = []
    for (const event of events) {
      const offsets = event.reminders || []
      if (!offsets.length) continue
      const startMs = new Date(event.start).getTime()
      const triggers = offsets
        .map((mins) => startMs - mins * 60000)
        .filter((t) => t >= fromMs && t < toMs)
      if (triggers.length) {
        due.push({ ...event, reminders: triggers.map((t) => new Date(t).toISOString()) })
      }
    }
    due.sort((a, b) => new Date(a.reminders[0]).getTime() - new Date(b.reminders[0]).getTime())
    res.json({ provider: provider.id, from, to, count: due.length, reminders: due })
  })

  router.get('/api/availability', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const from = req.query.from || startOfToday()
    const to = req.query.to || addDays(from, 7)
    const duration = assertPositiveInt(req.query.duration || '30', 'duration')
    const granularity = assertPositiveInt(req.query.granularity || '15', 'granularity')
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw badRequest('"from" and "to" must be valid ISO 8601 date-times.')
    }
    if (new Date(to) <= new Date(from)) {
      throw badRequest('"to" must be after "from".')
    }
    const slots = await provider.getAvailability({
      calendarId: req.query.calendarId || undefined,
      from,
      to,
      duration,
      granularity,
      ...parseWorkingHours(req.query),
    })
    res.json({ provider: provider.id, from, to, duration, count: slots.length, slots })
  })

  router.post('/api/conflicts', async (req, res) => {
    const provider = getProvider(req.body.provider)
    const { start, end } = parseConflictBody(req.body)
    const events = await provider.getEvents({
      calendarId: req.body.calendarId || undefined,
      from: start,
      to: end,
    })
    const conflicts = events.filter(
      (e) =>
        new Date(e.start).getTime() < new Date(end).getTime() &&
        new Date(e.end).getTime() > new Date(start).getTime(),
    )
    res.json({
      provider: provider.id,
      proposed: { start, end },
      clear: conflicts.length === 0,
      count: conflicts.length,
      conflicts,
    })
  })

  router.post('/api/book', async (req, res) => {
    const provider = getProvider(req.body.provider)
    const event = parseEventBody(req.body)
    const created = await provider.createEvent({
      calendarId: req.body.calendarId || undefined,
      event,
    })
    res.status(201).json({ booked: true, event: created })
  })

  router.patch('/api/events/:eventId', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const event = parseEventBody(req.body)
    const scope = parseScope(req.query.scope)
    const updated = await provider.updateEvent({
      calendarId: req.query.calendarId || undefined,
      eventId: req.params.eventId,
      event,
      scope,
    })
    res.json({ updated: true, event: updated, scope })
  })

  router.delete('/api/events/:eventId', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const scope = parseScope(req.query.scope)
    const result = await provider.deleteEvent({
      calendarId: req.query.calendarId || undefined,
      eventId: req.params.eventId,
      scope,
    })
    res.json({ ...result, provider: provider.id, scope })
  })

  // Export the calendar as a single .ics document. Series masters (with their
  // RRULE) are exported when the provider can produce them; otherwise expanded
  // instances are written as ordinary VEVENTs.
  router.get('/api/export/ics', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const calendarId = req.query.calendarId || undefined
    const events =
      typeof provider.getRawEvents === 'function'
        ? await provider.getRawEvents({ calendarId })
        : await provider.getEvents({ calendarId, from: '1970-01-01T00:00:00Z', to: '9999-12-31T23:59:59Z' })
    const text = eventsToIcs(events)
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="calendar-${provider.id}.ics"`)
    res.send(text)
  })

  // Import events from an ICS document. Every VEVENT is created on the target
  // provider's calendar; a VEVENT with an RRULE becomes a series master.
  router.post('/api/import/ics', async (req, res) => {
    const provider = getProvider(req.body.provider)
    const calendarId = req.body.calendarId || undefined
    if (!calendarId) throw badRequest('"calendarId" is required to import into a specific calendar.')
    if (typeof req.body.ics !== 'string' || !req.body.ics.trim()) {
      throw badRequest('"ics" must contain the iCalendar document as text.')
    }
    if (req.body.ics.length > 5_000_000) {
      throw badRequest('The ICS document is too large (5 MB limit).')
    }
    const { events, errors } = await parseIcs(req.body.ics)
    if (!events.length) {
      throw badRequest(`The ICS document contains no VEVENTs.${errors.length ? ` ${errors[0]}` : ''}`)
    }
    const created = []
    for (const event of events) {
      const { id: _ignored, ...body } = event
      try {
        const valid = parseEventBody(body)
        created.push(await provider.createEvent({ calendarId, event: valid }))
      } catch (err) {
        errors.push(`Skipped "${body.title || event.id}": ${err.message || err}.`)
      }
    }
    if (!created.length && errors.length) {
      throw badRequest(errors[0])
    }
    res.status(201).json({
      imported: created.length,
      provider: provider.id,
      calendarId,
      errors,
      events: created,
    })
  })

  return router
}

/** "this" (default), "following", or "all" — the series scope of an edit/delete. */
function parseScope(raw) {
  const scope = raw || 'this'
  if (!['this', 'following', 'all'].includes(scope)) {
    throw badRequest('"scope" must be "this", "following" or "all".')
  }
  return scope
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function addDays(iso, days) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/** OAuth `state` is a CSRF defence — it must always be cryptographically random. */
function cryptoRandom() {
  return crypto.randomUUID()
}
