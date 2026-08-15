# AI Calendar — Client

React + Vite calendar UI for the AI Calendar product. Talks to the calendar
interrogation API (see `../server`) through a Vite dev proxy at `/api`.

## Views

- **Month** — 6-week grid, up to 3 events per cell, drag events between days
- **Week** — 24h time grid with overlap-aware event blocks, drag to reschedule
- **Day** — single-day time grid
- **Agenda** — the next 14 days as a grouped list

## Local dev

```bash
npm install
npm run dev
```

Requires the server from the workspace root: `npm run dev` at the repo root runs
both. The API must be reachable for the UI to load calendars and events.
