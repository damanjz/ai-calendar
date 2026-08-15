export const CALENDAR_COLORS = [
  '#4f6ef7',
  '#ef6c8f',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
]

export function colorFor(calendarId, prefs, index) {
  return prefs?.[calendarId]?.color || CALENDAR_COLORS[index % CALENDAR_COLORS.length]
}

const PREFS_KEY = 'ai-calendar.prefs.v1'

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

export function initPrefs(calendars, existing = {}) {
  const next = { ...existing }
  calendars.forEach((cal, i) => {
    if (!next[cal.id]) {
      next[cal.id] = { visible: true, color: CALENDAR_COLORS[i % CALENDAR_COLORS.length] }
    }
  })
  return next
}
