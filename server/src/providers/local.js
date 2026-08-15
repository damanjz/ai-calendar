import crypto from 'node:crypto'
import pkg from 'rrule'
import CalendarProvider from './base.js'
import { dataPath, readJson, writeJson } from '../lib/fs-store.js'
import { basicIso, expandRecurring, parseRecurrence, MAX_INSTANCES_PER_SERIES } from '../lib/recurrence.js'
import { badRequest, notFound } from '../lib/errors.js'

const { RRule } = pkg

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
    const scoped = events.filter((e) => !calendarId || e.calendarId === calendarId)

    // Expand recurring events BEFORE the window filter: a series that started
    // before `from` must still contribute its occurrences inside the window.
    // Filtering first would drop the master and leave every occurrence free.
    const expanded = expandRecurring(scoped, { from, to })

    return expanded
      .filter((e) => new Date(e.end).getTime() > fromMs && new Date(e.start).getTime() < toMs)
      .map((e) => ({ ...e, provider: this.id }))
  }

  /**
   * Raw stored events (series masters, unexpanded) for export.
   *
   * `from`/`to` are ignored deliberately: the whole store is local and cheap to
   * read, and a series master must be exported with its RRULE intact even when
   * its DTSTART falls outside the requested window.
   */
  async getRawEvents({ calendarId }) {
    const { events } = this.load()
    const scoped = events.filter((e) => !calendarId || e.calendarId === calendarId)
    return scoped.map((e) => ({ ...e, provider: this.id }))
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

  async updateEvent({ calendarId, eventId, event, scope = 'this' }) {
    const store = this.load()
    const instance = splitInstanceId(eventId)

    if (instance) {
      const master = store.events.find((e) => e.id === instance.seriesId)
      if (!master) throw notFound(`Event "${eventId}" not found.`)
      if (!master.recurrence) throw badRequest(`Event "${eventId}" is not recurring.`)

      if (scope === 'this') {
        // A single-occurrence edit: stored as an exception keyed by the
        // occurrence it belongs to. Expansion turns it into the instance.
        master.exceptions = { ...master.exceptions, [instance.occurrenceKey]: { ...event } }
        this.save(store)
        return {
          ...event,
          id: eventId,
          provider: this.id,
          recurringEventId: master.id,
          originalStart: isoFromBasic(instance.occurrenceKey),
        }
      }
      if (scope === 'all') {
        return this.updateMaster(store, master, event, calendarId)
      }
      if (scope === 'following') {
        return this.splitFollowing(store, master, instance.occurrenceKey, event)
      }
      throw badRequest('"scope" must be "this", "following" or "all".')
    }

    const index = store.events.findIndex((e) => e.id === eventId)
    if (index === -1) throw notFound(`Event "${eventId}" not found.`)
    const existing = store.events[index]
    if (existing.recurrence && scope === 'following') {
      // "following" needs an occurrence to split at — a bare series id can't say which.
      throw badRequest(
        'For scope=following, pass an instance id (from /api/events) so the split point is unambiguous.',
      )
    }
    // A bare recurring master id means the whole series — same as scope=all.
    return this.updateMaster(store, existing, event, calendarId)
  }

  /** Edits a stored master in place (scope=all on a recurring series, or any plain event). */
  updateMaster(store, master, event, calendarId) {
    const index = store.events.findIndex((e) => e.id === master.id)
    const updated = { ...master, ...event, id: master.id, provider: this.id }
    if (calendarId) updated.calendarId = calendarId
    store.events[index] = updated
    this.save(store)
    return updated
  }

  /**
   * "This and all following" edit: the series is split at the edited occurrence.
   *
   * The original master is truncated to end just before it (UNTIL), and a new
   * series starts at the edited occurrence carrying the edited properties and
   * the same cadence, covering what used to be the remaining tail.
   */
  splitFollowing(store, master, occurrenceKey, event) {
    const { rr, occurrences } = this.enumerateSeries(master)
    const target = occurrences.findIndex((d) => basicIso(d) === occurrenceKey)
    if (target === -1) throw notFound(`Occurrence "${occurrenceKey}" is not part of this series.`)

    // The first occurrence is the whole series — a plain master edit.
    if (target === 0) return this.updateMaster(store, master, event)

    const options = rr.options
    const oldOptions = { ...options }
    delete oldOptions.count
    delete oldOptions.until
    master.recurrence = new RRule({ ...oldOptions, until: occurrences[target - 1] }).toString()
    master.exceptions = pickExceptionsBefore(master.exceptions, occurrenceKey)

    // The tail series is re-anchored to the edited occurrence: drop the fields
    // the old rule inferred from its own start (weekday + time) and let rrule
    // re-derive them from the new start, keeping only the explicit cadence.
    const newOptions = { ...options }
    for (const key of ['count', 'until', 'byday', 'byhour', 'byminute', 'bysecond', 'bymonth', 'bymonthday', 'byweekno', 'byyearday', 'bysetpos']) {
      delete newOptions[key]
    }
    if (options.count) newOptions.count = options.count - target
    const newMaster = {
      ...master,
      id: crypto.randomUUID(),
      ...event,
      start: event.start,
      end: event.end,
      recurrence: new RRule({ ...newOptions, dtstart: new Date(event.start) }).toString(),
      exceptions: {},
    }
    store.events.push(newMaster)
    this.save(store)
    return { ...newMaster, provider: this.id, recurringEventId: newMaster.id }
  }

  /** Returns { rr, occurrences } for a recurring master, capped at the instance ceiling. */
  enumerateSeries(master) {
    const dtstart = new Date(master.start)
    const rule = parseRecurrence(master.recurrence, dtstart)
    if (!rule) throw badRequest('Cannot operate on a series with an unparseable rule.')
    const rr = rule.rrules()[0]
    if (!rr) throw badRequest('Cannot operate on this series.')
    const horizon = new Date(dtstart.getTime() + 100 * 365 * 24 * 3600 * 1000)
    // Cap enumeration: a high-frequency rule (FREQ=MINUTELY) over a 100-year
    // horizon is tens of millions of dates and would hang the request. Stop at
    // the same ceiling expansion uses.
    let taken = 0
    const occurrences = rule.between(dtstart, horizon, true, () => ++taken <= MAX_INSTANCES_PER_SERIES)
    return { rr, occurrences }
  }

  async deleteEvent({ _calendarId, eventId, scope = 'this' }) {
    const store = this.load()
    const instance = splitInstanceId(eventId)

    if (instance) {
      const master = store.events.find((e) => e.id === instance.seriesId)
      if (!master) throw notFound(`Event "${eventId}" not found.`)
      if (!master.recurrence) throw badRequest(`Event "${eventId}" is not recurring.`)

      if (scope === 'this') {
        // Cancel just this occurrence (EXDATE semantics).
        master.exceptions = { ...master.exceptions, [instance.occurrenceKey]: { deleted: true } }
        this.save(store)
        return { deleted: true }
      }
      if (scope === 'all') {
        this.removeMaster(store, master.id)
        return { deleted: true, series: true }
      }
      if (scope === 'following') {
        const { rr, occurrences } = this.enumerateSeries(master)
        const target = occurrences.findIndex((d) => basicIso(d) === instance.occurrenceKey)
        if (target === -1) throw notFound(`Occurrence "${occurrenceKey}" is not part of this series.`)
        if (target === 0) {
          this.removeMaster(store, master.id)
          return { deleted: true, series: true }
        }
        const options = rr.options
        const oldOptions = { ...options }
        delete oldOptions.count
        delete oldOptions.until
        master.recurrence = new RRule({ ...oldOptions, until: occurrences[target - 1] }).toString()
        master.exceptions = pickExceptionsBefore(master.exceptions, instance.occurrenceKey)
        this.save(store)
        return { deleted: true, truncated: true }
      }
      throw badRequest('"scope" must be "this", "following" or "all".')
    }

    const index = store.events.findIndex((e) => e.id === eventId)
    if (index === -1) throw notFound(`Event "${eventId}" not found.`)
    if (store.events[index].recurrence && scope === 'following') {
      throw badRequest(
        'For scope=following, pass an instance id (from /api/events) so the split point is unambiguous.',
      )
    }
    this.removeMaster(store, eventId)
    return { deleted: true }
  }

  removeMaster(store, eventId) {
    const index = store.events.findIndex((e) => e.id === eventId)
    store.events.splice(index, 1)
    this.save(store)
  }
}

/**
 * Splits an instance id (`<seriesId>_<ISO basic occurrence start>`) into its
 * parts, or null when the id is not in that shape.
 */
function splitInstanceId(id) {
  const idx = id.lastIndexOf('_')
  if (idx === -1) return null
  const occurrenceKey = id.slice(idx + 1)
  if (!/^\d{8}T\d{6}Z$/.test(occurrenceKey)) return null
  return { seriesId: id.slice(0, idx), occurrenceKey }
}

/** Keeps only exceptions that belong to occurrences strictly before `key`. */
function pickExceptionsBefore(exceptions, key) {
  if (!exceptions) return {}
  return Object.fromEntries(Object.entries(exceptions).filter(([k]) => k < key))
}

/** 20310609T090000Z -> 2031-06-09T09:00:00.000Z */
function isoFromBasic(key) {
  const s = key.endsWith('Z') ? key.slice(0, -1) : key
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.000Z`
}
