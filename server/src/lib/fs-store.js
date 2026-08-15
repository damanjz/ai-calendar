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

export function writeJson(file, value) {
  ensureDataDir()
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

/**
 * Writes a file containing secrets with owner-only permissions (0600).
 *
 * The mode is applied on create AND via an explicit chmod, because an existing
 * file keeps its original permissions. No-ops on platforms without POSIX modes.
 */
export function writeSecretJson(file, value) {
  ensureDataDir()
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Windows and some mounted filesystems don't support chmod; the file is
    // still inside the git-ignored data dir.
  }
}

export function readFile(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function writeFile(file, contents) {
  ensureDataDir()
  fs.writeFileSync(file, contents)
}
