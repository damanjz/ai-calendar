import { addDays, formatDateShort, formatTimeRange, isSameDay, startOfDay, toKey } from '../lib/datetime'

export default function AgendaView({ events, colorMap, calendars, onEventClick }) {
  const start = startOfDay(new Date())
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i))

  const byDay = {}
  for (const ev of events) {
    const key = toKey(new Date(ev.start))
    ;(byDay[key] ||= []).push(ev)
  }

  const ordered = days.filter((d) => byDay[toKey(d)]?.length)
  const allEmpty = ordered.length === 0

  return (
    <section className="agenda-view">
      <header className="agenda-title">Upcoming (next 14 days)</header>
      {allEmpty ? (
        <p className="empty">No upcoming appointments in this window.</p>
      ) : (
        ordered.map((day) => {
          const key = toKey(day)
          const list = [...byDay[key]].sort(
            (a, b) => new Date(a.start) - new Date(b.start),
          )
          return (
            <div key={key} className="agenda-day">
              <div className={['agenda-day-label', isSameDay(day, new Date()) ? 'today' : ''].join(' ')}>
                {formatDateShort(day)}
              </div>
              <div className="agenda-day-events">
                {list.map((ev) => {
                  const calendar = calendars.find((c) => c.id === ev.calendarId)
                  return (
                    <button
                      type="button"
                      key={ev.id}
                      className="agenda-event"
                      onClick={() => onEventClick(ev)}
                    >
                      <span className="agenda-dot" style={{ background: colorMap[ev.calendarId] }} />
                      <span className="agenda-time">
                        {formatTimeRange(new Date(ev.start), new Date(ev.end))}
                      </span>
                      <span className="agenda-info">
                        <span className="agenda-title">{ev.title}</span>
                        {ev.description && (
                          <span className="agenda-description">{ev.description}</span>
                        )}
                      </span>
                      <span className="agenda-calendar">{calendar?.name || ev.calendarId}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </section>
  )
}
