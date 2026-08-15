import { getMonthGrid, toKey, WEEKDAYS } from '../lib/datetime'
import { EventChip } from './Event'

export default function MonthView({
  anchor,
  eventsByDay,
  colors,
  selectedKey,
  onSelectDay,
  onEventClick,
  onNewAt,
  onMoveEvent,
  draggingId,
  setDraggingId,
}) {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const cells = getMonthGrid(year, month)

  return (
    <section className="month-view">
      <div className="weekdays">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="month-grid">
        {cells.map((date) => {
          const key = toKey(date)
          const inMonth = date.getMonth() === month
          const events = eventsByDay[key] || []
          return (
            <div
              key={key}
              className={[
                'day-cell',
                inMonth ? '' : 'outside',
                key === selectedKey ? 'selected' : '',
              ].join(' ')}
              onClick={() => onSelectDay(key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (draggingId) onMoveEvent(draggingId, date)
              }}
            >
              <button
                type="button"
                className="day-number"
                onClick={(e) => {
                  e.stopPropagation()
                  onNewAt(key)
                }}
                title="Add booking on this day"
              >
                {date.getDate()}
              </button>
              <div className="day-events">
                {events.slice(0, 3).map((ev) => (
                  <EventChip
                    key={ev.id}
                    event={ev}
                    color={colors[ev.calendarId]}
                    onClick={onEventClick}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', ev.id)
                      setDraggingId(ev.id)
                    }}
                    onDragEnd={() => setDraggingId(null)}
                  />
                ))}
                {events.length > 3 && (
                  <span className="day-more">+{events.length - 3} more</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
