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
 *   attendees // [email, ...]
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

  /** Updates an event; returns the normalized updated event. @param {{calendarId?, eventId, event}} _args */
  async updateEvent(_args) {
    throw new Error('updateEvent not implemented')
  }

  /** Deletes an event. @param {{calendarId?, eventId}} _args */
  async deleteEvent(_args) {
    throw new Error('deleteEvent not implemented')
  }

  /** Computes free slots using the provider's own events. */
  async getAvailability({ calendarId, from, to, duration, granularity = 15 }) {
    const events = await this.getEvents({ calendarId, from, to })
    const slots = findFreeSlots(events, { from, to, duration, granularity })
    return slots.map((s) => ({ ...s, duration, provider: this.id, calendarId }))
  }
}
