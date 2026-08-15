import CalendarProvider from './base.js'
import { loadTokens, saveTokens } from '../auth/store.js'
import { badRequest, providerError } from '../lib/errors.js'

const AUTH_ENDPOINT = 'https://login.microsoftonline.com'
const GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0'
const SCOPES = 'offline_access Calendars.ReadWrite'

export default class OutlookProvider extends CalendarProvider {
  constructor(cfg) {
    super('outlook', 'Microsoft 365 / Outlook')
    this.cfg = cfg
    this._tokens = null
  }

  isConfigured() {
    return Boolean(this.cfg.enabled && this.cfg.clientId && this.cfg.clientSecret)
  }

  isReady() {
    return Boolean(this.isConfigured() && loadTokens('outlook'))
  }

  authority() {
    return `${AUTH_ENDPOINT}/${this.cfg.tenant}/oauth2/v2.0`
  }

  authUrl(state) {
    if (!this.isConfigured()) {
      throw badRequest('Outlook is not configured. See README for OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET.')
    }
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: this.cfg.redirectUri,
      response_mode: 'query',
      scope: SCOPES,
      prompt: 'consent',
      state,
    })
    return `${this.authority()}/authorize?${params.toString()}`
  }

  async exchangeCode(code) {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: this.cfg.redirectUri,
      code,
    })
  }

  async refreshToken(refreshToken) {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: refreshToken,
      scope: SCOPES,
    })
  }

  async tokenRequest(params) {
    const res = await fetch(`${this.authority()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw providerError(`Microsoft token exchange failed: ${data.error_description || data.error || res.status}`)
    }
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    }
    saveTokens('outlook', tokens)
    return tokens
  }

  async handleCallback(code) {
    return this.exchangeCode(code)
  }

  async auth() {
    let tokens = loadTokens('outlook')
    if (!tokens?.access_token) throw badRequest('Outlook is not authenticated yet.')
    if (tokens.expires_at && tokens.expires_at < Date.now() + 60000) {
      if (!tokens.refresh_token) throw badRequest('Outlook access token expired and no refresh token available.')
      tokens = await this.refreshToken(tokens.refresh_token)
    }
    return tokens.access_token
  }

  async graph(path, options = {}) {
    const token = await this.auth()
    const res = await fetch(`${GRAPH_ENDPOINT}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw providerError(`Microsoft Graph request failed (${res.status}): ${body.slice(0, 300)}`)
    }
    if (res.status === 204) return null
    return res.json()
  }

  normalize(item, calendarId) {
    const allDay = item.allDay !== false && item.start?.date && !item.start?.dateTime
    const event = {
      id: item.id,
      provider: this.id,
      calendarId: item.calendarId || calendarId || null,
      title: item.subject || '',
      description: item.bodyPreview || '',
      location: item.location?.displayName || '',
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      allDay,
      attendees: (item.attendees || []).map((a) => a.emailAddress?.address),
    }
    // calendarView returns type "occurrence"/"exception" for expanded series.
    if (item.seriesMasterId) {
      event.recurringEventId = item.seriesMasterId
      event.originalStart = event.start
    }
    return event
  }

  toGraphEvent(event) {
    return {
      subject: event.title,
      body: event.description ? { contentType: 'text', content: event.description } : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      start: { dateTime: new Date(event.start).toISOString(), timeZone: 'UTC' },
      end: { dateTime: new Date(event.end).toISOString(), timeZone: 'UTC' },
      attendees: event.attendees?.length
        ? event.attendees.map((email) => ({ emailAddress: { address: email }, type: 'required' }))
        : undefined,
    }
  }

  async getCalendars() {
    const data = await this.graph('/me/calendars')
    return data.value.map((c) => ({
      id: c.id,
      name: c.name || c.id,
      primary: Boolean(c.canShare),
    }))
  }

  async getEvents({ calendarId, from, to }) {
    // /calendarView, NOT /events. startDateTime and endDateTime are only
    // honoured by calendarView, which is also what expands recurring series
    // into individual occurrences. Against /events those params are ignored
    // and Graph returns series MASTERS, so a weekly meeting would appear once
    // at its series start and block no other slot.
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
      : '/me/calendarView'
    const params = new URLSearchParams({
      startDateTime: new Date(from).toISOString(),
      endDateTime: new Date(to).toISOString(),
      '$select': 'id,subject,bodyPreview,location,start,end,attendees,allDay,type,seriesMasterId',
      '$orderby': 'start/dateTime',
      '$top': '250',
    })
    const data = await this.graph(`${path}?${params.toString()}`)
    return (data.value || []).map((item) => this.normalize(item, calendarId))
  }

  async createEvent({ calendarId, event }) {
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/events`
      : '/me/events'
    const data = await this.graph(path, {
      method: 'POST',
      body: JSON.stringify(this.toGraphEvent(event)),
    })
    return this.normalize(data, calendarId)
  }

  async updateEvent({ calendarId, eventId, event, scope = 'this' }) {
    this.assertScope(scope)
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`
      : `/me/events/${eventId}`
    const data = await this.graph(path, {
      method: 'PATCH',
      body: JSON.stringify(this.toGraphEvent(event)),
    })
    return this.normalize(data, calendarId)
  }

  async deleteEvent({ calendarId, eventId, scope = 'this' }) {
    this.assertScope(scope)
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`
      : `/me/events/${eventId}`
    await this.graph(path, { method: 'DELETE' })
    return { deleted: true }
  }

  /**
   * Microsoft Graph ids are real: an occurrence id edits one instance ("this"),
   * the series master id edits the whole series ("all"). There is no
   * single-call "this and following" in the API.
   */
  assertScope(scope) {
    if (scope === 'following') {
      throw badRequest('"following" is not supported by Microsoft Graph; use scope=this (occurrence) or scope=all (series).')
    }
    if (scope !== 'this' && scope !== 'all') {
      throw badRequest('"scope" must be "this" or "all".')
    }
  }
}
