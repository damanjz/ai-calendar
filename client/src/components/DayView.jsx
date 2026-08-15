import { formatDateFull, formatTime, snapMinutes, toKey } from '../lib/datetime'
import { groupEventsByDay, layoutDayEvents } from '../lib/layout'
import { EventBlock } from './Event'

const HOUR_HEIGHT = 44

export default function DayView({
  anchor,
  events,
  colorMap,
  onEventClick,
  onMoveEvent,
  draggingId,
  setDraggingId,
}) {
  const days = [new Date(anchor)]
  const eventsByDay = groupEventsByDay(events, days)
  const laidOut = layoutDayEvents(eventsByDay[toKey(anchor)] || [], HOUR_HEIGHT)

  return (
    <section className="day-view">
      <header className="day-view-title">{formatDateFull(anchor)}</header>
      <div className="week-body">
        <div className="time-gutter">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="hour-label" style={{ top: h * HOUR_HEIGHT }}>
              {formatTime(new Date(2000, 0, 1, h))}
            </span>
          ))}
        </div>
        <div
          className="day-col"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (!draggingId) return
            const rect = e.currentTarget.getBoundingClientRect()
            const minutes = Math.round((e.clientY - rect.top) / HOUR_HEIGHT * 60)
            const snapped = Math.min(24 * 60 - 1, Math.max(0, snapMinutes(minutes, 15)))
            const target = new Date(anchor)
            target.setHours(0, snapped, 0, 0)
            onMoveEvent(draggingId, target)
          }}
        >
          {laidOut.map((ev) => (
            <EventBlock
              key={ev.id}
              event={ev}
              color={colorMap[ev.calendarId]}
              style={{
                top: ev.top,
                height: ev.height,
                left: `${ev.left}%`,
                width: `calc(${ev.width}% - 4px)`,
              }}
              onClick={onEventClick}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', ev.id)
                setDraggingId(ev.id)
              }}
              onDragEnd={() => setDraggingId(null)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
