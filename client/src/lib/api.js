const BASE = ''

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data?.error?.message || `Request failed (${res.status})`
    const err = new Error(message)
    err.code = data?.error?.code
    err.status = res.status
    throw err
  }
  return data
}

function params(obj) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, v)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const api = {
  health: () => request('/health'),

  providers: () => request('/api/providers'),

  calendars: (provider) => request(`/api/calendars${params({ provider })}`),

  events: (provider, calendarId, from, to) =>
    request(`/api/events${params({ provider, calendarId, from, to })}`),

  availability: (provider, calendarId, from, to, duration) =>
    request(`/api/availability${params({ provider, calendarId, from, to, duration })}`),

  conflicts: (provider, calendarId, start, end) =>
    request('/api/conflicts', {
      method: 'POST',
      body: JSON.stringify({ provider, calendarId, start, end }),
    }),

  book: (payload) =>
    request('/api/book', { method: 'POST', body: JSON.stringify(payload) }),

  update: (provider, calendarId, eventId, payload) =>
    request(`/api/events/${encodeURIComponent(eventId)}${params({ provider, calendarId })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  remove: (provider, calendarId, eventId) =>
    request(`/api/events/${encodeURIComponent(eventId)}${params({ provider, calendarId })}`, {
      method: 'DELETE',
    }),
}
