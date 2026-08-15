import { CALENDAR_COLORS } from '../lib/colors'

export default function Sidebar({
  providers,
  providerId,
  onProviderChange,
  calendars,
  prefs,
  onToggleCalendar,
  onCycleColor,
  onNewBooking,
}) {
  const ready = providers.filter((p) => p.ready)
  const selected = providers.find((p) => p.id === providerId)

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <label className="field-label" htmlFor="provider-select">Calendar provider</label>
        <select
          id="provider-select"
          value={providerId || ''}
          onChange={(e) => onProviderChange(e.target.value)}
          disabled={ready.length === 0}
        >
          {ready.length === 0 && <option value="">No provider ready</option>}
          {ready.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {selected && (
          <p className="provider-hint">{selected.name} connected.</p>
        )}
        {ready.length === 0 && (
          <p className="provider-hint warn">Start the server (npm run dev) to connect.</p>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Calendars</span>
        </div>
        {calendars.length === 0 ? (
          <p className="provider-hint">No calendars found.</p>
        ) : (
          <ul className="calendar-list">
            {calendars.map((cal) => {
              const pref = prefs[cal.id] || { visible: true }
              return (
                <li key={cal.id} className="calendar-row">
                  <button
                    type="button"
                    className="color-dot"
                    style={{ background: pref.color || CALENDAR_COLORS[0] }}
                    onClick={() => onCycleColor(cal.id)}
                    title="Change color"
                  />
                  <label className="calendar-name" title={cal.name}>
                    <input
                      type="checkbox"
                      checked={pref.visible !== false}
                      onChange={() => onToggleCalendar(cal.id)}
                    />
                    <span>{cal.name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <button type="button" className="primary add-button" onClick={onNewBooking}>
        + New booking
      </button>
    </aside>
  )
}
