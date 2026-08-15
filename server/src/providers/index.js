import config from '../config.js'
import LocalProvider from './local.js'
import GoogleProvider from './google.js'
import OutlookProvider from './outlook.js'
import CalDavProvider from './caldav.js'
import { badRequest } from '../lib/errors.js'

export function buildProviders() {
  return {
    local: new LocalProvider(),
    google: new GoogleProvider(config.google),
    outlook: new OutlookProvider(config.outlook),
    caldav: new CalDavProvider(config.caldav),
  }
}

const providers = buildProviders()

export function listProviders() {
  return Object.entries(providers).map(([id, p]) => ({
    id,
    name: p.name,
    configured: p.isConfigured(),
    ready: p.isReady(),
    active: config.activeProviders.includes(id),
  }))
}

export function getProvider(id) {
  const provider = providers[id]
  if (!provider) {
    throw badRequest(`Unknown provider "${id}". Available: ${Object.keys(providers).join(', ')}.`)
  }
  if (!provider.isConfigured()) {
    throw badRequest(
      `Provider "${id}" is not configured. Add the required environment variables.`,
    )
  }
  if (!provider.isReady()) {
    throw badRequest(
      `Provider "${id}" is not authenticated yet. Complete the OAuth flow at /api/auth/${id} first.`,
    )
  }
  return provider
}
