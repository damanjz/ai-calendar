import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import { initPrefs, loadPrefs, savePrefs, CALENDAR_COLORS } from './lib/colors'
import {
  addDays,
  addMonths,
  formatDateShort,
  getViewWindow,
  monthLabel,
  startOfWeek,
  toKey,
  todayKey,
} from './lib/datetime'
import ViewSwitcher from './components/ViewSwitcher'
import MonthView from './components/MonthView'
import WeekView from './components/WeekView'
import DayView from './components/DayView'
import AgendaView from './components/AgendaView'
import Sidebar from './components/Sidebar'
import BookingModal from './components/BookingModal'
import './App.css'

export default function App() {
  const [providers, setProviders] = useState([])
  const [providerId, setProviderId] = useState('')
  const [calendars, setCalendars] = useState([])
  const [prefs, setPrefs] = useState(loadPrefs)
  const [view, setView] = useState('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(todayKey())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState({ open: false, initial: null, defaultDate: todayKey() })
  const [draggingId, setDraggingId] = useState(null)

  useEffect(() => {
    api
      .providers()
      .then((data) => {
        setProviders(data.providers || [])
        const ready = data.providers?.filter((p) => p.ready)
        if (ready?.length) setProviderId(ready[0].id)
      })
      .catch((err) => setError(`Cannot reach the calendar API. Start the server with \`npm run dev\` (${err.message}).`))
  }, [])

  useEffect(() => {
    if (!providerId) return
    api
      .calendars(providerId)
      .then((data) => {
        const list = data.calendars || []
        setCalendars(list)
        setPrefs((prev) => initPrefs(list, prev))
      })
      .catch((err) => setError(err.message))
  }, [providerId])

  useEffect(() => {
    if (!providerId) return
    const { from, to } = getViewWindow(view, anchor)
    let cancelled = false
    setLoading(true)
    setError('')
    api
      .events(providerId, undefined, from.toISOString(), to.toISOString())
      .then((data) => {
        if (!cancelled) setEvents(data.events || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId, view, anchor])

  useEffect(() => {
    savePrefs(prefs)
  }, [prefs])

  const colorMap = useMemo(() => {
    const map = {}
    calendars.forEach((c, i) => {
      map[c.id] = prefs[c.id]?.color || CALENDAR_COLORS[i % CALENDAR_COLORS.length]
    })
    return map
  }, [calendars, prefs])

  const visibleEvents = useMemo(() => {
    return events.filter((e) => prefs[e.calendarId]?.visible !== false)
  }, [events, prefs])

  const eventsByKey = useMemo(() => {
    const map = {}
    for (const ev of visibleEvents) {
      const key = toKey(new Date(ev.start))
      ;(map[key] ||= []).push(ev)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => new Date(a.start) - new Date(b.start))
    }
    return map
  }, [visibleEvents])

  function handleProviderChange(id) {
    setProviderId(id)
    setCalendars([])
  }

  function handleToggleCalendar(id) {
    setPrefs((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), visible: !(prev[id]?.visible !== false) },
    }))
  }

  function handleCycleColor(id) {
    const current = prefs[id]?.color || CALENDAR_COLORS[0]
    const idx = CALENDAR_COLORS.indexOf(current)
    const next = CALENDAR_COLORS[(idx + 1) % CALENDAR_COLORS.length]
    setPrefs((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), color: next } }))
  }

  function navigate(delta) {
    setAnchor((prev) => {
      if (view === 'month') return addMonths(prev, delta)
      if (view === 'week') return addDays(prev, delta * 7)
      return addDays(prev, delta)
    })
  }

  function goToday() {
    setAnchor(new Date())
    setSelectedKey(todayKey())
  }

  function openNewBooking(dateKey) {
    setModal({ open: true, initial: null, defaultDate: dateKey || selectedKey })
  }

  function openEdit(event) {
    setModal({ open: true, initial: event, defaultDate: toKey(new Date(event.start)) })
  }

  async function handleSave(payload, editing) {
    if (editing) {
      await api.update(providerId, payload.calendarId, modal.initial.id, payload)
    } else {
      await api.book({ provider: providerId, ...payload })
    }
    setModal({ open: false, initial: null, defaultDate: payload.date || selectedKey })
    setSelectedKey(toKey(new Date(payload.start)))
    refresh()
  }

  async function handleDelete(event) {
    try {
      await api.remove(providerId, event.calendarId, event.id)
      setModal({ open: false, initial: null, defaultDate: selectedKey })
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleMove(eventId, targetDate) {
    const event = events.find((e) => e.id === eventId)
    if (!event) return
    const original = new Date(event.start)
    const duration = new Date(event.end) - original
    const newStart = new Date(targetDate)
    newStart.setHours(original.getHours(), original.getMinutes(), 0, 0)
    const newEnd = new Date(newStart.getTime() + duration)
    setDraggingId(null)
    try {
      await api.update(providerId, event.calendarId, event.id, {
        title: event.title,
        description: event.description || '',
        location: event.location || '',
        attendees: event.attendees || [],
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      })
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const refresh = useCallback(() => {
    const { from, to } = getViewWindow(view, anchor)
    setLoading(true)
    api
      .events(providerId, undefined, from.toISOString(), to.toISOString())
      .then((data) => setEvents(data.events || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [providerId, view, anchor])

  const windowLabel = useMemo(() => {
    if (view === 'month') return monthLabel(anchor)
    if (view === 'day') {
      return anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    }
    if (view === 'week') {
      const end = addDays(startOfWeek(anchor), 6)
      return `${formatDateShort(startOfWeek(anchor))} – ${formatDateShort(end)}`
    }
    return `Upcoming from ${formatDateShort(anchor)}`
  }, [view, anchor])

  const selectedCalendars = calendars.filter((c) => prefs[c.id]?.visible !== false)

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">▦</span>
          AI Calendar
        </div>
        <div className="header-center">
          <ViewSwitcher view={view} onChange={setView} />
        </div>
        <div className="header-nav">
          <button type="button" onClick={() => navigate(-1)} aria-label="Back">‹</button>
          <button type="button" className="today-btn" onClick={goToday}>Today</button>
          <button type="button" onClick={() => navigate(1)} aria-label="Forward">›</button>
        </div>
        <div className="header-title">{windowLabel}</div>
        <button type="button" className="primary new-btn" onClick={() => openNewBooking()}>
          + New booking
        </button>
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" onClick={() => { setError(''); window.location.reload() }}>Retry</button>
        </div>
      )}

      <div className="app-body">
        <Sidebar
          providers={providers}
          providerId={providerId}
          onProviderChange={handleProviderChange}
          calendars={calendars}
          prefs={prefs}
          onToggleCalendar={handleToggleCalendar}
          onCycleColor={handleCycleColor}
          onNewBooking={() => openNewBooking()}
        />
        <main className="main">
          {loading && <div className="loading-strip">Loading events…</div>}
          {view === 'month' && (
            <MonthView
              anchor={anchor}
              eventsByDay={eventsByKey}
              colors={colorMap}
              selectedKey={selectedKey}
              onSelectDay={setSelectedKey}
              onEventClick={openEdit}
              onNewAt={openNewBooking}
              onMoveEvent={handleMove}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
            />
          )}
          {view === 'week' && (
            <WeekView
              anchor={anchor}
              events={visibleEvents}
              colorMap={colorMap}
              onEventClick={openEdit}
              onMoveEvent={handleMove}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              onSelectDay={setSelectedKey}
              selectedKey={selectedKey}
            />
          )}
          {view === 'day' && (
            <DayView
              anchor={anchor}
              events={visibleEvents}
              colorMap={colorMap}
              onEventClick={openEdit}
              onMoveEvent={handleMove}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
            />
          )}
          {view === 'agenda' && (
            <AgendaView
              events={visibleEvents}
              colorMap={colorMap}
              calendars={selectedCalendars}
              onEventClick={openEdit}
            />
          )}
        </main>
      </div>

      {modal.open && (
        <BookingModal
          provider={providerId}
          calendars={calendars}
          initial={modal.initial}
          defaultDate={modal.defaultDate}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal({ open: false, initial: null, defaultDate: selectedKey })}
        />
      )}
    </div>
  )
}
