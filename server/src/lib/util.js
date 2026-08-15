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
 */
export function findFreeSlots(events, { from, to, duration, granularity = 15 }) {
  const windowStart = new Date(from).getTime()
  const windowEnd = new Date(to).getTime()
  const slotMs = minutesToMs(duration)
  const step = minutesToMs(granularity)

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
    const collides = busy.some((b) => b.start < candidateEnd && b.end > cursor)
    if (!collides) {
      slots.push({ start: toIso(cursor), end: toIso(candidateEnd) })
    }
    cursor += step
  }
  return slots
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
