const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function toKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey() {
  return toKey(new Date())
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function addMonths(date, n) {
  const d = new Date(date)
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  return d
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function startOfWeek(date) {
  const d = startOfDay(date)
  d.setDate(d.getDate() - d.getDay())
  return d
}

export function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function getWeekDays(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes()
}

export function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function minutesToTime(minutes) {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function snapMinutes(minutes, granularity = 15) {
  return Math.round(minutes / granularity) * granularity
}

export function formatTime(date) {
  let h = date.getHours()
  const m = String(date.getMinutes()).padStart(2, '0')
  const period = h >= 12 ? 'PM' : 'AM'
  h = h % 12 === 0 ? 12 : h % 12
  return `${h}:${m} ${period}`
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)} – ${formatTime(end)}`
}

export function formatDateShort(date) {
  return `${WEEKDAYS[date.getDay()]} ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
}

export function formatDateFull(date) {
  const day = date.getDate()
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
    : day % 10 === 3 && day !== 13 ? 'rd'
    : 'th'
  return `${WEEKDAYS_FULL[date.getDay()]}, ${MONTHS_FULL[date.getMonth()]} ${day}${suffix}, ${date.getFullYear()}`
}

export function monthLabel(date) {
  return `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`
}

export function toLocal(iso) {
  return new Date(iso)
}

/** Builds a local Date from a date key + 'HH:MM' string. */
export function fromDateAndTime(dateKey, hhmm) {
  const base = fromKey(dateKey)
  const [h, m] = String(hhmm).split(':').map(Number)
  base.setHours(h || 0, m || 0, 0, 0)
  return base
}

export function getViewWindow(view, anchor) {
  if (view === 'month') {
    const start = startOfMonth(anchor)
    return { from: start, to: addMonths(start, 1) }
  }
  if (view === 'week') {
    const start = startOfWeek(anchor)
    return { from: start, to: addDays(start, 7) }
  }
  if (view === 'day') {
    const start = startOfDay(anchor)
    return { from: start, to: addDays(start, 1) }
  }
  // agenda
  const start = startOfDay(anchor)
  return { from: start, to: addDays(start, 14) }
}

export { WEEKDAYS, MONTHS_SHORT, MONTHS_FULL }
