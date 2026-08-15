import { badRequest } from './errors.js'
import { parseRecurrence } from './recurrence.js'

/**
 * Largest reminder offset accepted on write: 28 days.
 *
 * This is the contract that lets `/api/reminders` stay correct with a bounded
 * event fetch — it widens its window by exactly this much to catch events
 * starting after `to` whose trigger falls inside it. Raising one without the
 * other silently drops the longest reminders.
 */
export const MAX_REMINDER_LEAD_MINUTES = 28 * 24 * 60

export function parseEventBody(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw badRequest('"title" is required.')
  if (title.length > 200) throw badRequest('"title" must be 200 characters or fewer.')

  const startRaw = body.start
  const endRaw = body.end
  if (!startRaw || !endRaw) {
    throw badRequest('"start" and "end" are required ISO 8601 date-times.')
  }
  const start = new Date(startRaw)
  const end = new Date(endRaw)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw badRequest('"start" and "end" must be valid ISO 8601 date-times.')
  }
  if (!(start < end)) {
    throw badRequest('"end" must be after "start".')
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const location = typeof body.location === 'string' ? body.location.trim() : ''
  const attendees = Array.isArray(body.attendees)
    ? body.attendees
        .map((a) => (typeof a === 'string' ? a.trim() : ''))
        .filter((a) => a.includes('@'))
    : []
  const allDay = Boolean(body.allDay)

  const category = typeof body.category === 'string' ? body.category.trim() : ''
  if (category.length > 50) throw badRequest('"category" must be 50 characters or fewer.')

  const reminders = []
  if (body.reminders !== undefined && body.reminders !== null) {
    if (!Array.isArray(body.reminders)) {
      throw badRequest('"reminders" must be an array of minutes-before-start offsets.')
    }
    if (body.reminders.length > 10) throw badRequest('"reminders" may have at most 10 entries.')
    for (const r of body.reminders) {
      if (!Number.isInteger(r) || r < 0) {
        throw badRequest('"reminders" entries must be non-negative integers (minutes before start).')
      }
      // Bounded so /api/reminders knows how far ahead to look for events whose
      // trigger falls inside the requested window. Without a ceiling the
      // look-ahead would have to be unbounded to stay correct.
      if (r > MAX_REMINDER_LEAD_MINUTES) {
        throw badRequest(
          `"reminders" entries must be at most ${MAX_REMINDER_LEAD_MINUTES} minutes (28 days) before the start.`,
        )
      }
      reminders.push(r)
    }
    if (new Set(reminders).size !== reminders.length) {
      throw badRequest('"reminders" entries must be distinct.')
    }
  }

  const event = {
    title,
    description,
    location,
    attendees,
    allDay,
    start: start.toISOString(),
    end: end.toISOString(),
  }
  if (category) event.category = category
  if (reminders.length) event.reminders = reminders.sort((a, b) => b - a)

  // Recurrence is optional. Validate it here rather than at expansion time so a
  // malformed rule is a 400 at write time, not a silently non-recurring event.
  if (body.recurrence !== undefined && body.recurrence !== null && body.recurrence !== '') {
    const recurrence = body.recurrence
    if (typeof recurrence !== 'string' && !Array.isArray(recurrence)) {
      throw badRequest('"recurrence" must be an RRULE string or an array of iCalendar lines.')
    }
    if (!parseRecurrence(recurrence, start)) {
      throw badRequest('"recurrence" is not a valid RRULE (e.g. "RRULE:FREQ=WEEKLY;COUNT=10").')
    }
    event.recurrence = recurrence
  }

  return event
}

export function parseConflictBody(body) {
  const startRaw = body.start
  const endRaw = body.end

  // "start" is required in both accepted forms: start+end, or start+duration.
  if (!startRaw) {
    throw badRequest('Provide either "start"+"end" or "start"+"duration".')
  }
  const start = new Date(startRaw)
  if (Number.isNaN(start.getTime())) {
    throw badRequest('"start" must be a valid ISO 8601 date-time.')
  }

  let end
  if (endRaw) {
    end = new Date(endRaw)
    if (Number.isNaN(end.getTime())) {
      throw badRequest('"end" must be a valid ISO 8601 date-time.')
    }
  } else {
    const duration = Number(body.duration)
    if (!Number.isInteger(duration) || duration <= 0) {
      throw badRequest('"duration" must be a positive integer number of minutes when "end" is omitted.')
    }
    end = new Date(start.getTime() + duration * 60000)
  }
  if (!(start < end)) {
    throw badRequest('"end" must be after "start".')
  }
  return { start: start.toISOString(), end: end.toISOString() }
}
