import { formatTime } from '../lib/datetime'

export function EventChip({ event, color, onClick, onDragStart, onDragEnd }) {
  return (
    <div
      className="event-chip"
      style={{ '--color': color }}
      draggable
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(event)
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={event.title}
    >
      {event.title}
    </div>
  )
}

export function EventBlock({ event, style, color, onClick, onDragStart, onDragEnd }) {
  return (
    <div
      className="event-block"
      style={{ ...style, '--color': color }}
      draggable
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(event)
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span className="event-block-time">{formatTime(event._start)}</span>
      <span className="event-block-title">{event.title}</span>
    </div>
  )
}
