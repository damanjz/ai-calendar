import { google } from 'googleapis'
import CalendarProvider from './base.js'
import { loadTokens, saveTokens } from '../auth/store.js'
import { ApiError, badRequest, providerError } from '../lib/errors.js'

export default class GoogleProvider extends CalendarProvider {
  constructor(cfg) {
    super('google', 'Google Calendar')
    this.cfg = cfg
  }

  isConfigured() {
    return Boolean(this.cfg.enabled && this.cfg.clientId && this.cfg.clientSecret)
  }

  isReady() {
    return Boolean(this.isConfigured() && loadTokens('google'))
  }

  oauth() {
    if (!this.isConfigured()) {
      throw badRequest('Google Calendar is not configured. See README for GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.')
    }
    return new google.auth.OAuth2(
      this.cfg.clientId,
      this.cfg.clientSecret,
      this.cfg.redirectUri,
    )
  }

  authUrl(state) {
    return this.oauth().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    })
  }

  async handleCallback(code) {
    const { tokens } = await this.oauth().getToken(code)
    saveTokens('google', tokens)
    return tokens
  }

  /**
   * Returns an authenticated Calendar client, refreshing the access token first
   * when it has expired.
   *
   * NOTE: this is deliberately the ONLY way to reach the API. It is async, so
   * every call site must `await` it before touching `.events` / `.calendarList`
   * — `await this.client().events.list()` would read `.events` off the pending
   * Promise (undefined) and throw before the await ever resolves.
   */
  async client() {
    const oauth = this.oauth()
    const tokens = loadTokens('google')
    if (!tokens) {
      throw badRequest('Google Calendar is not authenticated yet. Complete the OAuth flow at /api/auth/google first.')
    }
    oauth.setCredentials(tokens)
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      const { credentials } = await oauth.refreshAccessToken()
      saveTokens('google', credentials)
      oauth.setCredentials(credentials)
    }
    return google.calendar({ version: 'v3', auth: oauth })
  }

  async getCalendars() {
    try {
      const calendar = await this.client()
      const res = await calendar.calendarList.list()
      return (res.data.items || []).map((c) => ({
        id: c.id,
        name: c.summary || c.id,
        primary: Boolean(c.primary),
      }))
    } catch (err) {
      throw this.wrap(err, 'list calendars')
    }
  }

  /** Re-throws ApiErrors untouched; wraps anything else as a provider_error. */
  wrap(err, action) {
    if (err instanceof ApiError) return err
    return providerError(`Google Calendar ${action} failed: ${err.message}`, { cause: err.code })
  }

  normalize(item, calendarId) {
    const start = item.start?.dateTime || item.start?.date
    const end = item.end?.dateTime || item.end?.date
    const event = {
      id: item.id,
      provider: this.id,
      calendarId: item.calendarId || calendarId || null,
      title: item.summary || '',
      description: item.description || '',
      location: item.location || '',
      start,
      end,
      allDay: Boolean(item.start?.date && !item.start?.dateTime),
      attendees: (item.attendees || []).map((a) => a.email),
    }
    // singleEvents:true means Google expands series for us; each instance
    // carries the id of the master it came from.
    if (item.recurringEventId) {
      event.recurringEventId = item.recurringEventId
      event.originalStart = item.originalStartTime?.dateTime || item.originalStartTime?.date || start
    }
    return event
  }

  toGoogleEvent(event) {
    const body = {
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined,
      start: { dateTime: new Date(event.start).toISOString() },
      end: { dateTime: new Date(event.end).toISOString() },
    }
    if (event.attendees?.length) {
      body.attendees = event.attendees.map((email) => ({ email }))
    }
    return body
  }

  async getEvents({ calendarId, from, to }) {
    try {
      const calendar = await this.client()
      const res = await calendar.events.list({
        calendarId: calendarId || 'primary',
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      })
      return (res.data.items || []).map((item) => this.normalize(item, calendarId))
    } catch (err) {
      throw this.wrap(err, 'request')
    }
  }

  async createEvent({ calendarId, event }) {
    try {
      const calendar = await this.client()
      const res = await calendar.events.insert({
        calendarId: calendarId || 'primary',
        requestBody: this.toGoogleEvent(event),
      })
      return this.normalize(res.data, calendarId)
    } catch (err) {
      throw this.wrap(err, 'create')
    }
  }

  async updateEvent({ calendarId, eventId, event }) {
    try {
      const calendar = await this.client()
      const res = await calendar.events.update({
        calendarId: calendarId || 'primary',
        eventId,
        requestBody: this.toGoogleEvent(event),
      })
      return this.normalize(res.data, calendarId)
    } catch (err) {
      throw this.wrap(err, 'update')
    }
  }

  async deleteEvent({ calendarId, eventId }) {
    try {
      const calendar = await this.client()
      await calendar.events.delete({ calendarId: calendarId || 'primary', eventId })
      return { deleted: true }
    } catch (err) {
      throw this.wrap(err, 'delete')
    }
  }
}
