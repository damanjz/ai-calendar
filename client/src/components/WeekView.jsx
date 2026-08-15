import { addDays, formatTime, isSameDay, snapMinutes, startOfWeek, toKey } from '../lib/datetime'
import { groupEventsByDay, layoutDayEvents } from '../lib/layout'
import { EventBlock } from './Event'

const HOUR_HEIGHT = 44

function HourLabels() {
  return (
    <div className="time-gutter">
      {Array.from({ length: 24 }, (_, h) => (
        <span key={h} className="hour-label" style={{ top: h * HOUR_HEIGHT }}>
          {formatTime(new Date(2000, 0, 1, h))}
        </span>
      ))}
    </div>
  )
}

function DayColumn({ day, events, colorMap, onEventClick, onMoveEvent, draggingId, setDraggingId }) {
  const laidOut = layoutDayEvents(events, HOUR_HEIGHT)
  return (
    <div
      className="day-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (!draggingId) return
        const rect = e.currentTarget.getBoundingClientRect()
        const minutes = Math.round((e.clientY - rect.top) / HOUR_HEIGHT * 60)
        const snapped = Math.min(24 * 60 - 1, Math.max(0, snapMinutes(minutes, 15)))
        const target = new Date(day)
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
  )
}

export default function WeekView({
  anchor,
  events,
  colorMap,
  onEventClick,
  onMoveEvent,
  draggingId,
  setDraggingId,
  onSelectDay,
  selectedKey,
}) {
  const weekStart = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const eventsByDay = groupEventsByDay(events, days)

  return (
    <section className="week-view">
      <div className="week-header">
        <div className="gutter-spacer" />
        {days.map((day) => {
          const key = toKey(day)
          return (
            <button
              type="button"
              key={key}
              className={['day-header', isSameDay(day, new Date()) ? 'today' : '', key === selectedKey ? 'selected' : ''].join(' ')}
              onClick={() => onSelectDay(key)}
            >
              <span className="day-header-name">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()]}
              </span>
              <span className="day-header-date">{day.getDate()}</span>
            </button>
          )
        })}
      </div>
      <div className="week-body">
        <HourLabels />
        {days.map((day) => (
          <DayColumn
            key={toKey(day)}
            day={day}
            events={eventsByDay[toKey(day)] || []}
            colorMap={colorMap}
            onEventClick={onEventClick}
            onMoveEvent={onMoveEvent}
            draggingId={draggingId}
            setDraggingId={setDraggingId}
          />
        ))}
      </div>
    </section>
  )
}
