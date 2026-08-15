import { findFreeSlots } from '../lib/util.js'

/**
 * Provider contract. Every calendar provider implements these methods.
 *
 * Events are exchanged in this normalized shape:
 * {
 *   id, provider, calendarId,
 *   title, description, location,
 *   start,   // ISO 8601
 *   end,     // ISO 8601
 *   allDay,  // bool
 *   attendees, // [email, ...]
 *   category,  // optional free-form label
 *   reminders  // optional [minutesBeforeStart, ...]
 * }
 *
 * Recurring events are always returned EXPANDED: getEvents yields one concrete
 * instance per occurrence in [from, to), never a master carrying a rule. The
 * availability engine is purely interval-based, so an unexpanded master would
 * block only its first occurrence and leave the rest bookable.
 *
 * Instances additionally carry:
 * {
 *   recurringEventId, // id of the series this came from
 *   originalStart     // this occurrence's own start (ISO 8601)
 * }
 *
 * On write, an event may carry `recurrence` — an RRULE string or an array of
 * iCalendar lines. Only the `local` provider persists it today.
 */
export default class CalendarProvider {
  constructor(id, name) {
    this.id = id
    this.name = name
  }

  /** Whether credentials are present (regardless of OAuth token state). */
  isConfigured() {
    return true
  }

  /** Whether the provider currently has an authenticated session / usable store. */
  isReady() {
    return this.isConfigured()
  }

  /** Returns [{ id, name, primary }] for all calendars the account can read. */
  async getCalendars() {
    throw new Error('getCalendars not implemented')
  }

  /** Returns normalized events within [from, to). @param {{calendarId?, from, to}} _args */
  async getEvents(_args) {
    throw new Error('getEvents not implemented')
  }

  /** Creates an event; returns the normalized created event. @param {{calendarId?, event}} _args */
  async createEvent(_args) {
    throw new Error('createEvent not implemented')
  }

  /** Updates an event; returns the normalized updated event. @param {{calendarId?, eventId, event, scope?}} _args */
  async updateEvent(_args) {
    throw new Error('updateEvent not implemented')
  }

  /** Deletes an event. @param {{calendarId?, eventId, scope?}} _args */
  async deleteEvent(_args) {
    throw new Error('deleteEvent not implemented')
  }

  /**
   * Events as stored, for export: series masters with their rule intact rather
   * than expanded occurrences.
   *
   * Part of the contract so callers never have to feature-detect it. The
   * default satisfies it for providers that can only answer a windowed query
   * (google, outlook, caldav) by reading a bounded range — exporting those
   * yields expanded instances, which still round-trips, just without the RRULE.
   *
   * `from`/`to` are required: an unbounded range is a full-history sweep of a
   * remote API with no pagination guard, and recurring series silently truncate
   * at the expansion cap.
   *
   * @param {{calendarId?, from, to}} args
   */
  async getRawEvents({ calendarId, from, to }) {
    return this.getEvents({ calendarId, from, to })
  }

  /** Computes free slots using the provider's own events. */
  async getAvailability({ calendarId, from, to, duration, granularity = 15, timeZone, workingHours }) {
    const events = await this.getEvents({ calendarId, from, to })
    const slots = findFreeSlots(events, { from, to, duration, granularity, timeZone, workingHours })
    return slots.map((s) => ({ ...s, duration, provider: this.id, calendarId }))
  }
}
