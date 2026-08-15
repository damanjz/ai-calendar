// rrule ships CommonJS, so named ESM imports are not available — destructure
// from the default export instead.
import pkg from 'rrule'

const { rrulestr } = pkg

/**
 * Recurring events, expanded into concrete instances.
 *
 * The availability engine (`findFreeSlots`) and the conflict check are purely
 * interval-based: they read `start` and `end` and nothing else. A recurring
 * event therefore blocks only its FIRST occurrence unless it is expanded
 * first — and a series that began before the requested window is dropped by
 * the window filter entirely, so every one of its occurrences reads as free.
 *
 * Expansion happens inside each provider's `getEvents`, so every consumer
 * (availability, conflicts, and the raw /api/events read) is correct by
 * construction rather than by remembering to call a wrapper.
 */

/** Hard ceiling on instances per series, so a pathological rule can't exhaust memory. */
export const MAX_INSTANCES_PER_SERIES = 1000

/**
 * Parses a recurrence definition into an rrule object.
 *
 * Accepts what the various providers actually hand us:
 *   - a bare rule body:      "FREQ=WEEKLY;COUNT=4"
 *   - a prefixed RRULE line: "RRULE:FREQ=WEEKLY;COUNT=4"
 *   - an array of lines:     ["RRULE:...", "EXDATE:..."]  (Google's shape)
 *
 * Returns null when there is no rule, or when the rule is unparseable — the
 * caller then treats the event as a plain one-off rather than dropping it.
 */
export function parseRecurrence(recurrence, dtstart) {
  if (!recurrence) return null
  const lines = (Array.isArray(recurrence) ? recurrence : String(recurrence).split(/\r?\n/))
    .map((l) => String(l).trim())
    .filter(Boolean)
  if (!lines.length) return null

  // rrulestr needs an RRULE: prefix to recognise a rule body.
  const normalized = lines.map((line) =>
    /^(RRULE|EXRULE|EXDATE|RDATE|DTSTART)[:;]/i.test(line) ? line : `RRULE:${line}`,
  )

  // forceset:true is required so EXDATE/RDATE lines are honoured, but in that
  // mode the `dtstart` OPTION is ignored — the series start has to be supplied
  // as an inline DTSTART line instead.
  if (!normalized.some((l) => /^DTSTART[:;]/i.test(l)) && dtstart && !Number.isNaN(dtstart.getTime())) {
    normalized.unshift(`DTSTART:${basicIso(dtstart)}`)
  }

  try {
    const rule = rrulestr(normalized.join('\n'), { forceset: true })
    if (!rule || typeof rule.between !== 'function') return null
    // A set with no usable rule (e.g. "FREQ=NONSENSE" parsed away) yields nothing.
    if (typeof rule.rrules === 'function' && rule.rrules().length === 0) return null
    return rule
  } catch {
    return null
  }
}

/**
 * Expands any recurring events in `events` into concrete instances that fall
 * inside [from, to). Non-recurring events pass through untouched.
 *
 * Each instance carries:
 *   - a unique `id` (`<seriesId>_<ISO basic occurrence start>`), because the
 *     client keys render lists on id and duplicates mis-reconcile
 *   - `recurringEventId` — the series it came from
 *   - `originalStart`    — this occurrence's own start
 * and no `recurrence`, since an instance is concrete rather than a rule.
 */
export function expandRecurring(events, { from, to }) {
  const windowStart = new Date(from)
  const windowEnd = new Date(to)
  const out = []

  for (const event of events) {
    if (!event?.recurrence) {
      out.push(event)
      continue
    }

    const dtstart = new Date(event.start)
    const durationMs = new Date(event.end).getTime() - dtstart.getTime()
    const rule = parseRecurrence(event.recurrence, dtstart)

    if (!rule || Number.isNaN(dtstart.getTime())) {
      // Unparseable rule: fall back to the base event so time is still blocked.
      const { recurrence: _ignored, ...base } = event
      out.push(base)
      continue
    }

    // Look back by one duration so an occurrence that starts before the window
    // but runs into it is still counted as busy.
    const lookBehind = new Date(windowStart.getTime() - Math.max(durationMs, 0))

    let occurrences
    try {
      // Stop iterating at the cap rather than materialising every occurrence
      // and slicing afterwards: an unbounded FREQ=MINUTELY rule over a month
      // is ~40k dates, all of which would be built before being discarded.
      let taken = 0
      occurrences = rule.between(lookBehind, windowEnd, true, () => ++taken <= MAX_INSTANCES_PER_SERIES)
    } catch {
      const { recurrence: _ignored, ...base } = event
      out.push(base)
      continue
    }

    for (const occurrence of occurrences) {
      const start = new Date(occurrence)
      const end = new Date(start.getTime() + durationMs)
      // Drop occurrences that finish before the window opens.
      if (end <= windowStart) continue

      const { recurrence: _ignored, ...base } = event
      out.push({
        ...base,
        id: `${event.id}_${basicIso(start)}`,
        start: start.toISOString(),
        end: end.toISOString(),
        recurringEventId: event.id,
        originalStart: start.toISOString(),
      })
    }
  }

  return out
}

/** 2031-06-09T09:00:00.000Z -> 20310609T090000Z (the iCalendar id form). */
function basicIso(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
