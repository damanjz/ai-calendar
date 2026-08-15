import crypto from 'node:crypto'
import CalendarProvider from './base.js'
import { dataPath, readJson, writeJson } from '../lib/fs-store.js'
import { badRequest, notFound } from '../lib/errors.js'

const STORE_FILE = dataPath('local-calendar.json')

const DEFAULT_STORE = {
  calendars: [
    { id: 'work', name: 'Work', primary: true },
    { id: 'personal', name: 'Personal', primary: false },
  ],
  events: [],
}

export default class LocalProvider extends CalendarProvider {
  constructor() {
    super('local', 'Local (file-based)')
  }

  isConfigured() {
    return true
  }

  isReady() {
    return true
  }

  load() {
    return readJson(STORE_FILE, DEFAULT_STORE)
  }

  save(store) {
    writeJson(STORE_FILE, store)
  }

  async getCalendars() {
    const { calendars } = this.load()
    return calendars.map((c) => ({ id: c.id, name: c.name, primary: Boolean(c.primary) }))
  }

  async getEvents({ calendarId, from, to }) {
    const { events } = this.load()
    const fromMs = new Date(from).getTime()
    const toMs = new Date(to).getTime()
    return events
      .filter((e) => (!calendarId || e.calendarId === calendarId))
      .filter((e) => new Date(e.end).getTime() > fromMs && new Date(e.start).getTime() < toMs)
      .map((e) => ({ ...e, provider: this.id }))
  }

  async createEvent({ calendarId, event }) {
    const store = this.load()
    if (!store.calendars.some((c) => c.id === calendarId)) {
      throw badRequest(`Calendar "${calendarId}" does not exist.`)
    }
    const created = {
      ...event,
      id: crypto.randomUUID(),
      calendarId,
      provider: this.id,
    }
    store.events.push(created)
    this.save(store)
    return created
  }

  async updateEvent({ calendarId, eventId, event }) {
    const store = this.load()
    const index = store.events.findIndex((e) => e.id === eventId)
    if (index === -1) throw notFound(`Event "${eventId}" not found.`)
    const updated = { ...store.events[index], ...event, id: eventId, provider: this.id }
    if (calendarId) updated.calendarId = calendarId
    store.events[index] = updated
    this.save(store)
    return updated
  }

  async deleteEvent({ eventId }) {
    const store = this.load()
    const index = store.events.findIndex((e) => e.id === eventId)
    if (index === -1) throw notFound(`Event "${eventId}" not found.`)
    store.events.splice(index, 1)
    this.save(store)
    return { deleted: true }
  }
}
