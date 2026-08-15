import { endOfDay, startOfDay, toKey } from './datetime'

/** Groups events by day key, clamping each event to the visible day. */
export function groupEventsByDay(events, days) {
  const map = {}
  for (const day of days) {
    const key = toKey(day)
    const dayStart = startOfDay(day)
    const dayEnd = endOfDay(day)
    const list = []
    for (const ev of events) {
      const s = new Date(ev.start)
      const e = new Date(ev.end)
      if (s < dayEnd && e > dayStart) {
        list.push({
          ...ev,
          _start: new Date(Math.max(s, dayStart)),
          _end: new Date(Math.min(e, dayEnd)),
        })
      }
    }
    map[key] = list
  }
  return map
}

function assignColumns(events) {
  const usedUntil = []
  const cols = []
  for (const e of events) {
    const start = e._start.getTime()
    const end = e._end.getTime()
    let col = -1
    for (let i = 0; i < usedUntil.length; i++) {
      if (usedUntil[i] <= start) {
        col = i
        break
      }
    }
    if (col === -1) {
      col = usedUntil.length
      usedUntil.push(end)
    } else {
      usedUntil[col] = end
    }
    cols.push(col)
  }
  return cols
}

/**
 * Computes absolute positions for events inside a single day column.
 * Returns items with { top, height, left, width } plus the event data.
 */
export function layoutDayEvents(events, hourHeight) {
  const sorted = [...events].sort((a, b) => {
    const d = a._start.getTime() - b._start.getTime()
    return d !== 0 ? d : a._end.getTime() - b._end.getTime()
  })

  const clusters = []
  for (const e of sorted) {
    let placed = false
    for (const cluster of clusters) {
      const overlaps = cluster.some((c) => e._start < c._end && c._start < e._end)
      if (overlaps) {
        cluster.push(e)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([e])
  }

  const out = []
  for (const cluster of clusters) {
    const cols = assignColumns(cluster)
    const n = Math.max(1, cols.length)
    cluster.forEach((e, i) => {
      const startMin = e._start.getHours() * 60 + e._start.getMinutes()
      const endMin = e._end.getHours() * 60 + e._end.getMinutes()
      const top = (startMin / 60) * hourHeight
      const height = Math.max(((endMin - startMin) / 60) * hourHeight, 22)
      out.push({
        ...e,
        top,
        height,
        left: (cols[i] / n) * 100,
        width: 100 / n,
      })
    })
  }
  return out
}
