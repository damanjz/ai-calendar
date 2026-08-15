import { dataPath, readJson, writeJson } from '../lib/fs-store.js'

export function loadTokens(providerId) {
  return readJson(dataPath(`tokens-${providerId}.json`), null)
}

export function saveTokens(providerId, tokens) {
  writeJson(dataPath(`tokens-${providerId}.json`), tokens)
}

export function clearTokens(providerId) {
  saveTokens(providerId, null)
}
