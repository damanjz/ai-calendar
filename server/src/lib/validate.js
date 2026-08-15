import { badRequest } from './errors.js'

export function parseEventBody(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw badRequest('"title" is required.')
  if (title.length > 200) throw badRequest('"title" must be 200 characters or fewer.')

  const startRaw = body.start
  const endRaw = body.end
  if (!startRaw || !endRaw) {
    throw badRequest('"start" and "end" are required ISO 8601 date-times.')
  }
  const start = new Date(startRaw)
  const end = new Date(endRaw)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw badRequest('"start" and "end" must be valid ISO 8601 date-times.')
  }
  if (!(start < end)) {
    throw badRequest('"end" must be after "start".')
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const location = typeof body.location === 'string' ? body.location.trim() : ''
  const attendees = Array.isArray(body.attendees)
    ? body.attendees
        .map((a) => (typeof a === 'string' ? a.trim() : ''))
        .filter((a) => a.includes('@'))
    : []
  const allDay = Boolean(body.allDay)

  return {
    title,
    description,
    location,
    attendees,
    allDay,
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

export function parseConflictBody(body) {
  const startRaw = body.start
  const endRaw = body.end

  // "start" is required in both accepted forms: start+end, or start+duration.
  if (!startRaw) {
    throw badRequest('Provide either "start"+"end" or "start"+"duration".')
  }
  const start = new Date(startRaw)
  if (Number.isNaN(start.getTime())) {
    throw badRequest('"start" must be a valid ISO 8601 date-time.')
  }

  let end
  if (endRaw) {
    end = new Date(endRaw)
    if (Number.isNaN(end.getTime())) {
      throw badRequest('"end" must be a valid ISO 8601 date-time.')
    }
  } else {
    const duration = Number(body.duration)
    if (!Number.isInteger(duration) || duration <= 0) {
      throw badRequest('"duration" must be a positive integer number of minutes when "end" is omitted.')
    }
    end = new Date(start.getTime() + duration * 60000)
  }
  if (!(start < end)) {
    throw badRequest('"end" must be after "start".')
  }
  return { start: start.toISOString(), end: end.toISOString() }
}
