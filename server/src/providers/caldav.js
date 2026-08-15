import ical from 'node-ical'
import crypto from 'node:crypto'
import CalendarProvider from './base.js'
import { MAX_INSTANCES_PER_SERIES } from '../lib/recurrence.js'
import { ApiError, badRequest, providerError } from '../lib/errors.js'

/** 2031-06-09T09:00:00.000Z -> 20310609T090000Z (the iCalendar id form). */
function basicIso(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export default class CalDavProvider extends CalendarProvider {
  constructor(cfg) {
    super('caldav', 'CalDAV (Apple, Nextcloud, etc.)')
    this.cfg = cfg
  }

  isConfigured() {
    return Boolean(
      this.cfg.enabled && this.cfg.baseUrl && this.cfg.username && this.cfg.password,
    )
  }

  isReady() {
    return this.isConfigured()
  }

  urls() {
    return this.cfg.baseUrl
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
  }

  basicAuth() {
    return 'Basic ' + Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64')
  }

  calendarName(url) {
    const trimmed = url.replace(/\/+$/, '')
    return trimmed.split('/').filter(Boolean).pop() || url
  }

  async getCalendars() {
    return this.urls().map((url, i) => ({
      id: url,
      name: this.calendarName(url),
      primary: i === 0,
    }))
  }

  /**
   * Fetches and parses one calendar collection.
   *
   * Fetching is separated from parsing so the transport is a single seam:
   * node-ical's fromURL uses its own HTTP client, which makes the network
   * layer awkward to substitute. Going through fetch() keeps this provider
   * consistent with putEvent/deleteEvent, which already use it.
   */
  async fetchCalendar(url) {
    const res = await fetch(url, { headers: { Authorization: this.basicAuth() } })
    if (!res.ok) {
      throw providerError(`CalDAV fetch failed for ${url} (${res.status}).`)
    }
    return ical.async.parseICS(await res.text())
  }

  async getEvents({ calendarId, from, to }) {
    const targets = calendarId ? [calendarId] : this.urls()
    const events = []
    for (const url of targets) {
      let data
      try {
        data = await this.fetchCalendar(url)
      } catch (err) {
        if (err instanceof ApiError) throw err
        throw providerError(`CalDAV fetch failed for ${url}: ${err.message}`)
      }
      const fromMs = new Date(from).getTime()
      const toMs = new Date(to).getTime()

      for (const key of Object.keys(data)) {
        const item = data[key]
        if (!item || item.type !== 'VEVENT') continue
        const start = item.start instanceof Date ? item.start : new Date(item.start)
        const end = item.end instanceof Date ? item.end : new Date(item.end)
        if (!start || Number.isNaN(start.getTime())) continue

        // node-ical parses RRULEs but never expands them: it hands back the
        // master with a rule attached. Expanding is left to us — without it a
        // weekly meeting that began before this window is filtered out below
        // and every one of its occurrences reads as free.
        if (item.rrule) {
          for (const instance of this.expandVEvent(item, url, start, end, from, to)) {
            if (instance.endMs > fromMs && instance.startMs < toMs) events.push(instance.event)
          }
          continue
        }

        if (!(end.getTime() > fromMs && start.getTime() < toMs)) continue
        events.push(this.normalize(item, url, start, end))
      }
    }
    return events
  }

  /**
   * Expands a recurring VEVENT into concrete instances.
   *
   * node-ical gives us three separate pieces which must be combined:
   *   - `item.rrule`       a live RRule instance (already parsed)
   *   - `item.exdate`      cancelled occurrences, keyed by date
   *   - `item.recurrences` per-occurrence overrides (a moved or retitled one)
   *
   * Returns `{ event, startMs, endMs }` so the caller can window-filter
   * without re-parsing the dates.
   */
  expandVEvent(item, calendarId, start, end, from, to) {
    const durationMs = end.getTime() - start.getTime()
    const windowStart = new Date(from)
    const windowEnd = new Date(to)
    // Look back one duration so an occurrence straddling the window start counts.
    const lookBehind = new Date(windowStart.getTime() - Math.max(durationMs, 0))

    let occurrences
    try {
      let taken = 0
      occurrences = item.rrule.between(lookBehind, windowEnd, true, () => ++taken <= MAX_INSTANCES_PER_SERIES)
    } catch {
      return [{ event: this.normalize(item, calendarId, start, end), startMs: start.getTime(), endMs: end.getTime() }]
    }

    const out = []
    for (const occurrence of occurrences) {
      const dateKey = occurrence.toISOString().slice(0, 10)

      // EXDATE: this occurrence was cancelled.
      if (item.exdate && item.exdate[dateKey]) continue

      // RECURRENCE-ID override: this occurrence was edited (moved/retitled).
      const override = item.recurrences?.[dateKey]
      if (override) {
        const oStart = override.start instanceof Date ? override.start : new Date(override.start)
        const oEnd = override.end instanceof Date ? override.end : new Date(override.end)
        if (!Number.isNaN(oStart.getTime())) {
          const event = this.normalize(override, calendarId, oStart, oEnd)
          event.id = `${item.uid}_${basicIso(oStart)}`
          event.recurringEventId = String(item.uid)
          event.originalStart = oStart.toISOString()
          out.push({ event, startMs: oStart.getTime(), endMs: oEnd.getTime() })
        }
        continue
      }

      const iStart = new Date(occurrence)
      const iEnd = new Date(iStart.getTime() + durationMs)
      const event = this.normalize(item, calendarId, iStart, iEnd)
      // Instances of one series would otherwise all share the master's UID.
      event.id = `${item.uid}_${basicIso(iStart)}`
      event.recurringEventId = String(item.uid)
      event.originalStart = iStart.toISOString()
      out.push({ event, startMs: iStart.getTime(), endMs: iEnd.getTime() })
    }
    return out
  }

  normalize(item, calendarId, start, end) {
    const attendees = []
    const raw = item.attendee
    if (Array.isArray(raw)) {
      for (const a of raw) attendees.push(String(a).replace(/^mailto:/i, ''))
    } else if (raw) {
      attendees.push(String(raw).replace(/^mailto:/i, ''))
    }
    return {
      id: String(item.uid || crypto.randomUUID()),
      provider: this.id,
      calendarId,
      title: item.summary || '',
      description: item.description || '',
      location: item.location || '',
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: Boolean(item.datetype === 'date'),
      attendees,
    }
  }

  toIcs(event, uid) {
    const dtStart = new Date(event.start)
    const dtEnd = new Date(event.end)
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//calendar-interrogation//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${fmt(dtStart)}`,
      `DTEND:${fmt(dtEnd)}`,
      `SUMMARY:${this.escapeText(event.title)}`,
    ]
    if (event.description) lines.push(`DESCRIPTION:${this.escapeText(event.description)}`)
    if (event.location) lines.push(`LOCATION:${this.escapeText(event.location)}`)
    for (const email of event.attendees || []) {
      lines.push(`ATTENDEE;CN=${this.escapeText(email)};ROLE=REQ-PARTICIPANT:mailto:${email}`)
    }
    lines.push('END:VEVENT', 'END:VCALENDAR')
    return lines.join('\r\n') + '\r\n'
  }

  escapeText(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  }

  async putEvent(calendarId, uid, event) {
    const target = calendarId || this.urls()[0]
    const url = target.endsWith('/') ? `${target}${uid}.ics` : `${target}/${uid}.ics`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: this.basicAuth(),
        'Content-Type': 'text/calendar; charset=utf-8',
      },
      body: this.toIcs(event, uid),
    })
    if (!res.ok && res.status !== 201) {
      throw providerError(`CalDAV write failed for ${url} (${res.status}).`)
    }
  }

  async createEvent({ calendarId, event }) {
    const uid = crypto.randomUUID()
    await this.putEvent(calendarId, uid, event)
    return {
      id: uid,
      ...event,
      provider: this.id,
      calendarId: calendarId || this.urls()[0],
    }
  }

  async updateEvent({ calendarId, eventId, event, scope = 'all' }) {
    this.assertScope(scope)
    if (!eventId) throw badRequest('eventId is required to update a CalDAV event.')
    await this.putEvent(calendarId, eventId, event)
    return {
      id: eventId,
      ...event,
      provider: this.id,
      calendarId: calendarId || this.urls()[0],
    }
  }

  async deleteEvent({ calendarId, eventId, scope = 'all' }) {
    this.assertScope(scope)
    const target = calendarId || this.urls()[0]
    const url = target.endsWith('/') ? `${target}${eventId}.ics` : `${target}/${eventId}.ics`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.basicAuth() },
    })
    if (!res.ok && res.status !== 404) {
      throw providerError(`CalDAV delete failed for ${url} (${res.status}).`)
    }
    return { deleted: true }
  }

  /**
   * CalDAV is a file-per-event protocol: a write replaces the whole .ics
   * resource. That only maps to the whole series ("all"). Single-occurrence
   * edits ("this") and splits ("following") need RECURRENCE-ID/EXDATE
   * machinery that the plain PUT path cannot express, so they are rejected.
   */
  assertScope(scope) {
    if (scope !== 'all') {
      throw badRequest(`"${scope}" is not supported by CalDAV; use scope=all to edit the whole series resource.`)
    }
  }
}
