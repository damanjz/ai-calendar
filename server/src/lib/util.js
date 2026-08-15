import crypto from 'node:crypto'
import { ApiError, badRequest } from './errors.js'

export function minutesToMs(mins) {
  return mins * 60 * 1000
}

export function msToMinutes(ms) {
  return Math.round(ms / 60000)
}

export function isValidIso(date) {
  return typeof date === 'string' && !Number.isNaN(Date.parse(date))
}

export function assertIso(value, name) {
  if (!isValidIso(value)) {
    throw badRequest(`"${name}" must be a valid ISO 8601 date/time.`)
  }
  return new Date(value)
}

export function toIso(date) {
  return new Date(date).toISOString()
}

export function assertPositiveInt(value, name) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`"${name}" must be a positive integer.`)
  }
  return n
}

export function assertOneOf(value, choices, name) {
  if (!choices.includes(value)) {
    throw badRequest(`"${name}" must be one of: ${choices.join(', ')}.`)
  }
  return value
}

/**
 * Returns true when interval [aStart, aEnd) and [bStart, bEnd) overlap.
 * All inputs are Date objects.
 */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Sorts events by start and computes free windows inside [from, to).
 * Produces slots of exactly `duration` minutes, advancing by `granularity`.
 *
 * Optional `workingHours` ({ days: [0-6...], start, end }) restricts slots to
 * the given local wall-clock window on the given days. When `timeZone` (an IANA
 * name) is provided the local day/time is interpreted there; otherwise the
 * slot's UTC day/time is used.
 */
/**
 * Hard ceiling on slot-scan iterations. A 100-year window at 1-minute
 * granularity is ~52M steps; without a bound one request pins a CPU core and
 * blocks the single-threaded server. 200k covers any sane query (e.g. a full
 * year at 5-minute granularity ≈ 105k).
 */
export const MAX_SLOT_ITERATIONS = 200_000

export function findFreeSlots(events, { from, to, duration, granularity = 15, timeZone, workingHours }) {
  const windowStart = new Date(from).getTime()
  const windowEnd = new Date(to).getTime()
  const slotMs = minutesToMs(duration)
  const step = minutesToMs(granularity)

  // Refuse an abusive scan up front rather than looping into a hang.
  const iterations = Math.ceil((windowEnd - windowStart) / step)
  if (iterations > MAX_SLOT_ITERATIONS) {
    throw badRequest(
      `Requested availability range is too large. Narrow the window or increase "granularity" ` +
        `(at most ${MAX_SLOT_ITERATIONS} slots per request).`,
    )
  }

  const busy = events
    .map((e) => {
      const start = new Date(e.start).getTime()
      const end = new Date(e.end).getTime()
      return { start: Math.max(start, windowStart), end: Math.min(end, windowEnd) }
    })
    .filter((e) => e.start < e.end)
    .sort((a, b) => a.start - b.start)

  const slots = []
  let cursor = Math.ceil(windowStart / step) * step
  if (cursor < windowStart) cursor = windowStart

  while (cursor + slotMs <= windowEnd) {
    const candidateEnd = cursor + slotMs
    if (!workingHours || withinWorkingHours(cursor, candidateEnd, timeZone, workingHours)) {
      const collides = busy.some((b) => b.start < candidateEnd && b.end > cursor)
      if (!collides) {
        slots.push({ start: toIso(cursor), end: toIso(candidateEnd) })
      }
    }
    cursor += step
  }
  return slots
}

/** True when [startMs, endMs) falls inside a working-hours window in `timeZone`. */
function withinWorkingHours(startMs, endMs, timeZone, { days, start, end }) {
  const s = localWallClock(startMs, timeZone)
  const e = localWallClock(endMs, timeZone)
  if (!days.includes(s.day)) return false
  if (s.day !== e.day) return false
  return s.minutes >= start && e.minutes <= end
}

/** The local wall-clock day (0=Sunday) and minutes-of-day at `ms` in `timeZone`. */
export function localWallClock(ms, timeZone) {
  if (timeZone) {
    const p = zonedParts(ms, timeZone)
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
    return { day, minutes: p.hour * 60 + p.minute }
  }
  const d = new Date(ms)
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

/**
 * Parses working-hours query parameters:
 *   workDays  "1-5" or "1,2,3,4" (0=Sunday..6=Saturday)
 *   workStart "09:00"
 *   workEnd   "17:00"
 *   timeZone  "America/New_York"
 * Returns null when no working-hours param is given; throws `badRequest` on
 * malformed input. `timeZone` may be set alone and is passed through for the
 * day-of-week/time interpretation.
 */
export function parseWorkingHours({ timeZone, workDays, workStart, workEnd }) {
  if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
    throw badRequest(`"timeZone" must be an IANA time zone, e.g. "America/New_York".`)
  }
  const hasAny = workDays !== undefined || workStart !== undefined || workEnd !== undefined
  if (!hasAny) return null
  const days = parseWorkDays(workDays ?? '1-5')
  const start = parseClock(workStart ?? '09:00', 'workStart')
  const end = parseClock(workEnd ?? '17:00', 'workEnd')
  if (end <= start) throw badRequest('"workEnd" must be after "workStart".')
  return { timeZone: timeZone || undefined, workingHours: { days, start, end } }
}

function parseWorkDays(raw) {
  const out = new Set()
  for (const part of String(raw).split(',')) {
    const m = part.trim().match(/^(\d)(?:-(\d))?$/)
    if (!m) throw badRequest('"workDays" must use day numbers 0 (Sunday) to 6 (Saturday), e.g. "1-5".')
    const lo = Number(m[1])
    const hi = Number(m[2] ?? m[1])
    if (lo > 6 || hi > 6 || hi < lo) {
      throw badRequest('"workDays" ranges must be within 0 (Sunday) to 6 (Saturday).')
    }
    for (let d = lo; d <= hi; d++) out.add(d)
  }
  if (out.size === 0) throw badRequest('"workDays" must list at least one day.')
  return [...out]
}

function parseClock(raw, name) {
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) throw badRequest(`"${name}" must be "HH:MM", e.g. "09:00".`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h === 24 && min === 0) return 24 * 60 // end-of-day sentinel
  if (h > 23 || min > 59) throw badRequest(`"${name}" must be a valid time.`)
  return h * 60 + min
}

function isValidTimeZone(name) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name }).format()
    return true
  } catch {
    return false
  }
}

/** Breaks `ms` into local wall-clock parts in `timeZone` (or UTC when absent). */
function zonedParts(ms, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(ms))
  const get = (t) => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Returns events that overlap the proposed [start, end). */
export function findConflicts(events, start, end) {
  return events.filter((e) =>
    intervalsOverlap(new Date(start), new Date(end), new Date(e.start), new Date(e.end)),
  )
}

/**
 * Constant-time comparison of two secrets.
 *
 * A plain `!==` short-circuits on the first differing byte, which leaks the
 * length of the matching prefix through response timing. Lengths are compared
 * via a hash so that differing-length inputs stay constant-time too (and so
 * timingSafeEqual never throws on a length mismatch).
 */
export function safeKeyEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length === 0 || b.length === 0) return false
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function requireApiKey(req, apiKey) {
  if (!apiKey) return
  const provided =
    req.header('x-api-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!safeKeyEquals(provided, apiKey)) {
    throw new ApiError(401, 'unauthorized', 'Missing or invalid API key.')
  }
}
