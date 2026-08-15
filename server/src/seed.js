import { dataPath, writeJson, ensureDataDir } from './lib/fs-store.js'

const STORE_FILE = dataPath('local-calendar.json')

ensureDataDir()
writeJson(STORE_FILE, {
  calendars: [
    { id: 'work', name: 'Work', primary: true },
    { id: 'personal', name: 'Personal', primary: false },
  ],
  events: [],
})
console.log(`Local calendar reset (no events) at ${STORE_FILE}`)
