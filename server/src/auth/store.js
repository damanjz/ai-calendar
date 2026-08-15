import { dataPath, readJson, writeSecretJson } from '../lib/fs-store.js'

export function loadTokens(providerId) {
  return readJson(dataPath(`tokens-${providerId}.json`), null)
}

/** OAuth tokens are the highest-value secret here — written owner-only (0600). */
export function saveTokens(providerId, tokens) {
  writeSecretJson(dataPath(`tokens-${providerId}.json`), tokens)
}

export function clearTokens(providerId) {
  saveTokens(providerId, null)
}
