import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * config.js reads env at import time, so each case needs a fresh module
 * instance. A cache-busting query string gives us that.
 */
let n = 0
async function loadConfig(env) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const mod = await import(`../src/config.js?case=${n++}`)
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return mod.default
}

const CLEAN = { API_PORT: undefined, PORT: undefined, GOOGLE_REDIRECT_URI: undefined, OUTLOOK_REDIRECT_URI: undefined }

test('API_PORT takes precedence over PORT', async () => {
  const c = await loadConfig({ ...CLEAN, API_PORT: '4000', PORT: '5173' })
  assert.equal(c.port, 4000, 'PORT must not win — launchers inject it for the app being started')
})

test('OAuth redirect URIs always match the port the server actually binds', async () => {
  // A mismatch sends the provider to a dead port after consent: the failure
  // only appears in the live OAuth flow, and reads as a provider problem.
  for (const env of [
    { ...CLEAN, API_PORT: '4000' },
    { ...CLEAN, PORT: '3500' },
    { ...CLEAN },
  ]) {
    const c = await loadConfig(env)
    assert.ok(
      c.google.redirectUri.includes(`:${c.port}/`),
      `google redirect ${c.google.redirectUri} does not match bind port ${c.port}`,
    )
    assert.ok(
      c.outlook.redirectUri.includes(`:${c.port}/`),
      `outlook redirect ${c.outlook.redirectUri} does not match bind port ${c.port}`,
    )
  }
})

test('an explicit redirect URI is still respected', async () => {
  const c = await loadConfig({
    ...CLEAN,
    API_PORT: '4000',
    GOOGLE_REDIRECT_URI: 'https://example.test/cb',
  })
  assert.equal(c.google.redirectUri, 'https://example.test/cb')
})

test('defaults are safe: loopback bind, scoped CORS, no API key', async () => {
  const c = await loadConfig({ ...CLEAN, HOST: undefined, CORS_ORIGIN: undefined })
  assert.equal(c.host, '127.0.0.1')
  assert.equal(c.isLoopback, true)
  assert.equal(c.corsOrigin, 'http://localhost:5173')
  assert.notEqual(c.corsOrigin, '*')
})
