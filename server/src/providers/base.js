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

  /** Returns normalized events within [from, to). */
  async getEvents({ _calendarId, _from, _to }) {
    throw new Error('getEvents not implemented')
  }

  /** Creates an event; returns the normalized created event. */
  async createEvent({ _calendarId, _event }) {
    throw new Error('createEvent not implemented')
  }

  /** Updates an event; returns the normalized updated event. */
  async updateEvent({ _calendarId, _eventId, _event }) {
    throw new Error('updateEvent not implemented')
  }

  /** Deletes an event. */
  async deleteEvent({ _calendarId, _eventId }) {
    throw new Error('deleteEvent not implemented')
  }

  /** Computes free slots using the provider's own events. */
  async getAvailability({ calendarId, from, to, duration, granularity = 15 }) {
    const events = await this.getEvents({ calendarId, from, to })
    const slots = findFreeSlots(events, { from, to, duration, granularity })
    return slots.map((s) => ({ ...s, duration, provider: this.id, calendarId }))
  }
}
