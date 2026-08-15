import { google } from 'googleapis'
import CalendarProvider from './base.js'
import { loadTokens, saveTokens } from '../auth/store.js'
import { badRequest, providerError } from '../lib/errors.js'

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

  async calendar() {
    const oauth = this.oauth()
    oauth.setCredentials(loadTokens('google'))
    return google.calendar({ version: 'v3', auth: oauth })
  }

  async refreshIfNeeded() {
    const oauth = this.oauth()
    const tokens = loadTokens('google')
    oauth.setCredentials(tokens)
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      const { credentials } = await oauth.refreshAccessToken()
      saveTokens('google', credentials)
      oauth.setCredentials(credentials)
    }
  }

  async getCalendars() {
    await this.refreshIfNeeded()
    const res = await this.calendar().calendarList.list()
    return res.data.items.map((c) => ({
      id: c.id,
      name: c.summary || c.id,
      primary: Boolean(c.primary),
    }))
  }

  normalize(item, calendarId) {
    const start = item.start?.dateTime || item.start?.date
    const end = item.end?.dateTime || item.end?.date
    return {
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
    await this.refreshIfNeeded()
    try {
      const res = await this.calendar().events.list({
        calendarId,
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      })
      return res.data.items.map((item) => this.normalize(item, calendarId))
    } catch (err) {
      throw providerError(`Google Calendar request failed: ${err.message}`, { cause: err.code })
    }
  }

  async createEvent({ calendarId, event }) {
    await this.refreshIfNeeded()
    try {
      const res = await this.calendar().events.insert({
        calendarId,
        requestBody: this.toGoogleEvent(event),
      })
      return this.normalize(res.data, calendarId)
    } catch (err) {
      throw providerError(`Google Calendar create failed: ${err.message}`, { cause: err.code })
    }
  }

  async updateEvent({ calendarId, eventId, event }) {
    await this.refreshIfNeeded()
    try {
      const res = await this.calendar().events.update({
        calendarId,
        eventId,
        requestBody: this.toGoogleEvent(event),
      })
      return this.normalize(res.data, calendarId)
    } catch (err) {
      throw providerError(`Google Calendar update failed: ${err.message}`, { cause: err.code })
    }
  }

  async deleteEvent({ calendarId, eventId }) {
    await this.refreshIfNeeded()
    try {
      await this.calendar().events.delete({ calendarId, eventId })
      return { deleted: true }
    } catch (err) {
      throw providerError(`Google Calendar delete failed: ${err.message}`, { cause: err.code })
    }
  }
}
