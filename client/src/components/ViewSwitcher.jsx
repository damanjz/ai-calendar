const VIEWS = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
  { id: 'agenda', label: 'Agenda' },
]

export default function ViewSwitcher({ view, onChange }) {
  return (
    <div className="view-switcher" role="tablist" aria-label="Calendar view">
      {VIEWS.map((v) => (
        <button
          type="button"
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          className={view === v.id ? 'active' : ''}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
