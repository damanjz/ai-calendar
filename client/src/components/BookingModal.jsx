import { useState } from 'react'
import { fromDateAndTime, formatTimeRange, toKey, toLocal, minutesToTime } from '../lib/datetime'
import { api } from '../lib/api'

export default function BookingModal({
  provider,
  calendars,
  initial,
  defaultDate,
  onSave,
  onDelete,
  onClose,
}) {
  const editing = Boolean(initial?.id)
  const [title, setTitle] = useState(initial?.title || '')
  const [calendarId, setCalendarId] = useState(
    initial?.calendarId || calendars[0]?.id || '',
  )
  const [date, setDate] = useState(initial ? toKey(toLocal(initial.start)) : defaultDate)
  const [start, setStart] = useState(initial ? minutesToTime(hoursOf(initial.start)) : '09:00')
  const [end, setEnd] = useState(initial ? minutesToTime(hoursOf(initial.end)) : '10:00')
  const [description, setDescription] = useState(initial?.description || '')
  const [location, setLocation] = useState(initial?.location || '')
  const [attendees, setAttendees] = useState((initial?.attendees || []).join(', '))
  const [error, setError] = useState('')
  const [conflicts, setConflicts] = useState([])
  const [allowConflict, setAllowConflict] = useState(false)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)

  function hoursOf(iso) {
    const d = toLocal(iso)
    return d.getHours() * 60 + d.getMinutes()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const startDate = fromDateAndTime(date, start)
    const endDate = fromDateAndTime(date, end)

    if (!title.trim()) {
      setError('Please enter a title.')
      return
    }
    if (!calendarId) {
      setError('Please choose a calendar.')
      return
    }
    if (!(startDate < endDate)) {
      setError('End time must be after start time.')
      return
    }

    const payload = {
      title: title.trim(),
      calendarId,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      description: description.trim(),
      location: location.trim(),
      attendees: attendees
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    }

    if (!editing && conflicts.length === 0 && !allowConflict) {
      setChecking(true)
      try {
        const res = await api.conflicts(provider, calendarId, payload.start, payload.end)
        setConflicts(res.conflicts || [])
        if (res.conflicts?.length > 0 && !allowConflict) {
          setChecking(false)
          return
        }
      } catch (err) {
        setError(err.message)
        setChecking(false)
        return
      }
      setChecking(false)
    }

    if (!editing && conflicts.length > 0 && !allowConflict) {
      return
    }

    setSaving(true)
    try {
      await onSave(payload, editing)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  function handleDelete() {
    if (window.confirm(`Delete "${initial.title}"?`)) {
      onDelete(initial)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{editing ? 'Edit appointment' : 'Book appointment'}</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Coffee with Sam"
            autoFocus
          />
        </label>

        <label>
          Calendar
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            {calendars.length === 0 && <option value="">No calendars available</option>}
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <div className="time-row">
          <label>
            Start
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            End
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <label>
          Location <span className="optional">(optional)</span>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Room, address, or video link"
          />
        </label>

        <label>
          Description <span className="optional">(optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows="3"
            placeholder="Any additional notes"
          />
        </label>

        <label>
          Attendees <span className="optional">(comma separated)</span>
          <input
            type="text"
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            placeholder="sam@example.com, jane@example.com"
          />
        </label>

        {checking && <p className="form-note">Checking availability…</p>}

        {conflicts.length > 0 && (
          <div className="conflict-box">
            <p className="conflict-heading">
              Overlaps with {conflicts.length} event{conflicts.length > 1 ? 's' : ''}:
            </p>
            <ul className="conflict-list">
              {conflicts.map((c) => (
                <li key={c.id}>
                  <strong>{c.title}</strong>{' '}
                  <span className="conflict-time">{formatTimeRange(new Date(c.start), new Date(c.end))}</span>
                </li>
              ))}
            </ul>
            {!editing && (
              <label className="conflict-allow">
                <input
                  type="checkbox"
                  checked={allowConflict}
                  onChange={(e) => setAllowConflict(e.target.checked)}
                />
                Book anyway (double-book)
              </label>
            )}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <footer className="modal-footer">
          {editing && (
            <button type="button" className="danger" onClick={handleDelete}>Delete</button>
          )}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Book appointment'}
          </button>
        </footer>
      </form>
    </div>
  )
}
