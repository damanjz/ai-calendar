import ical from 'node-ical'
import crypto from 'node:crypto'
import CalendarProvider from './base.js'
import { badRequest, providerError } from '../lib/errors.js'

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

  async getEvents({ calendarId, from, to }) {
    const targets = calendarId ? [calendarId] : this.urls()
    const events = []
    for (const url of targets) {
      let data
      try {
        data = await ical.async.fromURL(url, {
          headers: { Authorization: this.basicAuth() },
        })
      } catch (err) {
        throw providerError(`CalDAV fetch failed for ${url}: ${err.message}`)
      }
      for (const key of Object.keys(data)) {
        const item = data[key]
        if (!item || item.type !== 'VEVENT') continue
        const start = item.start instanceof Date ? item.start : new Date(item.start)
        const end = item.end instanceof Date ? item.end : new Date(item.end)
        if (!start || Number.isNaN(start.getTime())) continue
        if (!(end.getTime() > new Date(from).getTime() && start.getTime() < new Date(to).getTime())) {
          continue
        }
        events.push(this.normalize(item, url, start, end))
      }
    }
    return events
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

  async updateEvent({ calendarId, eventId, event }) {
    if (!eventId) throw badRequest('eventId is required to update a CalDAV event.')
    await this.putEvent(calendarId, eventId, event)
    return {
      id: eventId,
      ...event,
      provider: this.id,
      calendarId: calendarId || this.urls()[0],
    }
  }

  async deleteEvent({ calendarId, eventId }) {
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
}
