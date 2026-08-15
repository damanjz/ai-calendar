import crypto from 'node:crypto'
import { Router } from 'express'
import config from './config.js'
import { getProvider, listProviders } from './providers/index.js'
import { parseEventBody, parseConflictBody } from './lib/validate.js'
import { requireApiKey, assertPositiveInt } from './lib/util.js'
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
    res.json({ provider: provider.id, from, to, count: events.length, events })
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
    const updated = await provider.updateEvent({
      calendarId: req.query.calendarId || undefined,
      eventId: req.params.eventId,
      event,
    })
    res.json({ updated: true, event: updated })
  })

  router.delete('/api/events/:eventId', async (req, res) => {
    const provider = getProvider(req.query.provider)
    const result = await provider.deleteEvent({
      calendarId: req.query.calendarId || undefined,
      eventId: req.params.eventId,
    })
    res.json({ ...result, provider: provider.id })
  })

  return router
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
