import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-calendar-fsstore-'))
const { writeJson, writeSecretJson, readJson, dataPath } = await import('../src/lib/fs-store.js')

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }))

test('writeJson then readJson round-trips', () => {
  const f = dataPath('rt.json')
  writeJson(f, { a: 1, nested: { b: [1, 2, 3] } })
  assert.deepEqual(readJson(f, null), { a: 1, nested: { b: [1, 2, 3] } })
})

test('writeJson leaves no temp files behind on success', () => {
  const f = dataPath('clean.json')
  writeJson(f, { ok: true })
  const strays = fs.readdirSync(process.env.DATA_DIR).filter((n) => n.includes('.tmp'))
  assert.deepEqual(strays, [], 'no .tmp-* files should remain after a successful write')
})

test('a crash mid-write cannot corrupt the existing file (atomic replace)', () => {
  const f = dataPath('atomic.json')
  writeJson(f, { events: ['keep-me'] })

  // Simulate a process dying while a NEW write is only half-committed: the
  // partial content lands in a temp file, and the real file is only ever
  // swapped in by an atomic rename. So a leftover temp must never overwrite
  // the good file, and the good file must still parse.
  const tmp = f + '.tmp-crash'
  fs.writeFileSync(tmp, '{ "events": [ "half') // truncated, invalid JSON
  // The real file is untouched by that partial write:
  assert.deepEqual(readJson(f, null), { events: ['keep-me'] }, 'existing data survives a broken temp write')

  // A subsequent successful write replaces it wholesale, never appending.
  writeJson(f, { events: ['new'] })
  assert.deepEqual(readJson(f, null), { events: ['new'] })
  fs.rmSync(tmp, { force: true })
})

test('writeJson replaces content wholesale (no stale bytes from a longer previous value)', () => {
  const f = dataPath('shrink.json')
  writeJson(f, { big: 'x'.repeat(500) })
  writeJson(f, { small: 1 })
  const raw = fs.readFileSync(f, 'utf8')
  assert.equal(raw.includes('xxxxx'), false, 'a shorter write must not leave tail bytes from the old one')
  assert.deepEqual(readJson(f, null), { small: 1 })
})

test('a failed write leaves neither a temp file nor a damaged target', () => {
  const f = dataPath('fail.json')
  writeJson(f, { events: ['original'] })

  // A value that cannot be serialized throws inside writeJson; the original
  // file must be untouched and no temp file may leak.
  const circular = {}
  circular.self = circular
  assert.throws(() => writeJson(f, circular))

  assert.deepEqual(readJson(f, null), { events: ['original'] }, 'target survives a failed write')
  const strays = fs.readdirSync(process.env.DATA_DIR).filter((n) => n.includes('.tmp'))
  assert.deepEqual(strays, [], 'a failed write must clean up its temp file')
})

test('writeSecretJson round-trips and (on POSIX) is owner-only', () => {
  const f = dataPath('secret.json')
  writeSecretJson(f, { token: 'abc' })
  assert.deepEqual(readJson(f, null), { token: 'abc' })
  if (process.platform !== 'win32') {
    const mode = fs.statSync(f).mode & 0o777
    assert.equal(mode, 0o600, 'secret file must be 0600 on POSIX')
  }
})
