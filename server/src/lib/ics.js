// ICS (iCalendar) import/export helpers.
//
// Parsing goes through node-ical (the same library the CalDAV provider uses);
// serialization is a small writer that produces the subset of VCALENDAR that
// round-trips through this server: VEVENTs with SUMMARY/DESCRIPTION/LOCATION,
// DTSTART/DTEND, attendees, and an RRULE when the event is a series master.

import ical from 'node-ical'
import crypto from 'node:crypto'

/**
 * Largest ICS document accepted on import.
 *
 * The JSON body limit in app.js is derived from this so that the route's own
 * size check is what rejects an oversized document — with a message naming ICS
 * — rather than body-parser failing first with a generic error.
 */
export const MAX_ICS_BYTES = 5_000_000

/** The iCalendar basic form of a Date: 2031-06-09T09:00:00Z -> 20310609T090000Z. */
function basicIso(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Escapes ICS text per RFC 5545 (backslash, semicolon, comma, newline). */
export function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')
}

/**
 * Serializes normalized events into a single VCALENDAR document.
 *
 * A non-recurring event becomes one VEVENT. A series master (an event that
 * carries `recurrence`) becomes a VEVENT with its RRULE, so exporting a master
 * series round-trips as a rule rather than as N one-off occurrences. Expanded
 * instances (which carry `recurringEventId` and no `recurrence`) are written
 * as ordinary one-off VEVENTs.
 */
export function eventsToIcs(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ai-calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const event of events) {
    const vevent = eventToVevent(event)
    lines.push(...foldLines(vevent))
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

function eventToVevent(event) {
  const uid = String(event.id || event.uid || cryptoRandomUid())
  const stamp = basicIso(new Date())
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${basicIso(new Date(event.start))}`,
    `DTEND:${basicIso(new Date(event.end))}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ]
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)
  if (event.category) lines.push(`CATEGORIES:${escapeIcsText(event.category)}`)
  for (const email of event.attendees || []) {
    lines.push(`ATTENDEE;CN=${escapeIcsText(email)};ROLE=REQ-PARTICIPANT:mailto:${email}`)
  }
  if (event.recurrence) {
    for (const line of recurrenceLines(event.recurrence)) {
      lines.push(line)
    }
  }
  lines.push('END:VEVENT')
  return lines
}

/** Splits a stored recurrence (string or array of iCalendar lines) into lines. */
function recurrenceLines(recurrence) {
  const lines = (Array.isArray(recurrence) ? recurrence : String(recurrence).split(/\r?\n/))
    .map((l) => String(l).trim())
    .filter(Boolean)
  // Normalise the bare-rule form ("FREQ=WEEKLY;COUNT=4") back to an RRULE line.
  return lines.map((l) => (/^(RRULE|EXDATE|RDATE|DTSTART)[:;]/i.test(l) ? l : `RRULE:${l}`))
}

/**
 * Folds ICS lines longer than 75 octets per RFC 5545 (CRLF + one space).
 * The surrounding CRLF separators are NOT included in `lines`.
 */
function foldLines(lines) {
  const out = []
  for (const line of lines) {
    const bytes = Buffer.byteLength(line, 'utf8')
    if (bytes <= 75) {
      out.push(line)
      continue
    }
    // Fold on UTF-8 character boundaries by walking code points.
    let rest = line
    while (Buffer.byteLength(rest, 'utf8') > 75) {
      let cut = 75
      while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--
      out.push(rest.slice(0, cut))
      rest = ' ' + rest.slice(cut) // continuation lines start with a space
    }
    out.push(rest)
  }
  return out
}

/**
 * Parses an ICS document into normalized events.
 *
 * A VEVENT with an RRULE is returned as a series MASTER carrying `recurrence`
 * (so it can be stored and later expanded); EXDATEs are folded into that
 * recurrence as extra lines. A VEVENT without a rule is returned as a plain
 * event. Recurrence-id overrides are ignored — the master rule is enough for a
 * bulk import, and storing a moved occurrence correctly is a write-time choice.
 *
 * Returns `{ events, count, errors }`: `errors` lists skipped components (a
 * malformed entry should not abort the whole import).
 */
export async function parseIcs(text) {
  const data = await ical.async.parseICS(normalizeDateTimes(String(text)))
  const events = []
  const errors = []
  for (const key of Object.keys(data)) {
    const item = data[key]
    if (!item || item.type !== 'VEVENT') continue
    const start = item.start instanceof Date ? item.start : new Date(item.start)
    const end = item.end instanceof Date ? item.end : new Date(item.end)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      errors.push(`Skipped component "${key}": unparseable start/end.`)
      continue
    }
    const attendees = []
    const raw = item.attendee
    if (Array.isArray(raw)) {
      for (const a of raw) attendees.push(String(a).replace(/^mailto:/i, ''))
    } else if (raw) {
      attendees.push(String(raw).replace(/^mailto:/i, ''))
    }
    const event = {
      id: String(item.uid || key),
      title: item.summary || '',
      description: item.description || '',
      location: item.location || '',
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: Boolean(item.datetype === 'date'),
      attendees,
    }
    if (item.categories) {
      const cats = Array.isArray(item.categories) ? item.categories : [item.categories]
      event.category = cats.map((c) => String(c)).join(', ').trim()
    }
    const recLines = []
    if (item.rrule) {
      // node-ical hands back a live RRule; toString gives DTSTART + RRULE lines.
      recLines.push(...String(item.rrule).split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    }
    if (item.exdate) {
      for (const dateKey of Object.keys(item.exdate)) {
        const ex = item.exdate[dateKey]
        if (ex instanceof Date) recLines.push(`EXDATE:${basicIso(ex)}`)
      }
    }
    if (recLines.length) event.recurrence = recLines
    events.push(event)
  }
  return { events, count: events.length, errors }
}

function cryptoRandomUid() {
  return crypto.randomUUID()
}

/**
 * Rewrites the extended ISO form (`2031-06-09T09:00:00Z`) into the basic form
 * (`20310609T090000Z`) on DTSTART/DTEND/EXDATE lines. node-ical only parses the
 * basic form when a component carries an RRULE, and some exporters emit the
 * extended form; normalising keeps imports robust either way.
 */
function normalizeDateTimes(text) {
  return text.replace(
    /^(DTSTART|DTEND|EXDATE|RECURRENCE-ID)[;:].*$/gim,
    (line) => line.replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/g, (_m, y, mo, d, h, mi, s) => `${y}${mo}${d}T${h}${mi}${s}`),
  )
}
