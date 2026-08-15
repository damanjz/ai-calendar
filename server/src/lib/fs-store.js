import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')

export function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts)
}

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * Atomically writes `contents` to `file`: write to a temp file in the same
 * directory, then rename over the target. rename(2) is atomic on the same
 * filesystem, so a crash mid-write leaves EITHER the old file intact OR the new
 * one complete — never a truncated store. Without this, a Ctrl-C or power loss
 * during writeFileSync could corrupt local-calendar.json and lose every event.
 */
function writeFileAtomic(file, contents, options = {}) {
  ensureDataDir()
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(tmp, contents, options)
    fs.renameSync(tmp, file)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // best-effort cleanup of the temp file
    }
    throw err
  }
  // An existing target keeps its original permissions through a rename, so
  // re-assert the mode when one was requested (matters for 0600 secrets).
  if (options.mode !== undefined) {
    try {
      fs.chmodSync(file, options.mode)
    } catch {
      // Windows / some mounted filesystems don't support chmod.
    }
  }
}

export function writeJson(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2))
}

/**
 * Writes a file containing secrets atomically with owner-only permissions (0600).
 */
export function writeSecretJson(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2), { mode: 0o600 })
}

export function readFile(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function writeFile(file, contents) {
  writeFileAtomic(file, contents)
}
