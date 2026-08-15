import express from 'express'
import config from './config.js'
import { createRouter } from './router.js'
import { ensureDataDir } from './lib/fs-store.js'
import { ApiError } from './lib/errors.js'

/**
 * Builds the Express app without binding a port, so tests can drive it over
 * an ephemeral listener. `server.js` is the only place that calls listen().
 */
export function createApp() {
  ensureDataDir()

  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

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
    console.error(err)
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error.' } })
  })

  return app
}

export default createApp
