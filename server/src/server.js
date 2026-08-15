import config from './config.js'
import { createApp } from './app.js'

const app = createApp()

app.listen(config.port, config.host, () => {
  const providers = config.activeProviders.length ? config.activeProviders.join(', ') : 'none'
  console.log(`calendar-interrogation listening on http://${config.host}:${config.port}`)
  console.log(`active providers: ${providers}`)

  // Loud about the two ways this can be unintentionally exposed.
  if (!config.isLoopback && !config.apiKey) {
    console.warn(
      `⚠  Bound to ${config.host} with no API_KEY set — every /api route is open to your network.\n` +
        '   Set API_KEY, or bind to 127.0.0.1 (the default).',
    )
  }
  if (!config.isLoopback && config.corsOrigin === '*') {
    console.warn('⚠  CORS_ORIGIN=* while bound to a non-loopback address — any site can call this API.')
  }
})
