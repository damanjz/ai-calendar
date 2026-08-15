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
