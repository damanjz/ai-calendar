import express from 'express'
import config from './config.js'
import { createRouter } from './router.js'
import { ensureDataDir } from './lib/fs-store.js'
import { ApiError } from './lib/errors.js'
import { MAX_ICS_BYTES } from './lib/ics.js'

/**
 * JSON body ceiling. Sized above the ICS import limit so that route's own
 * size check is the one that fires, with a specific message — previously the
 * body-parser limit (1mb) rejected first and the 5MB check was dead code.
 */
const MAX_JSON_BODY = `${Math.ceil((MAX_ICS_BYTES * 1.4) / 1_000_000)}mb`

/**
 * Builds the Express app without binding a port, so tests can drive it over
 * an ephemeral listener. `server.js` is the only place that calls listen().
 */
export function createApp() {
  ensureDataDir()

  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: MAX_JSON_BODY }))

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key')
    if (config.corsOrigin !== '*') res.setHeader('Vary', 'Origin')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.use(createRouter())

  app.use((req, res) => {
    res
      .status(404)
      .json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } })
  })

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(err.toJSON())
      return
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_request', message: 'Invalid JSON body.' } })
      return
    }
    // body-parser rejects oversized bodies before any route runs. Untranslated
    // this surfaced as a 500 "Internal server error" with nothing actionable.
    if (err?.type === 'entity.too.large') {
      res.status(413).json({
        error: {
          code: 'payload_too_large',
          message: `Request body is too large (limit ${MAX_JSON_BODY}).`,
        },
      })
      return
    }
    console.error(err)
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error.' } })
  })

  return app
}

export default createApp
