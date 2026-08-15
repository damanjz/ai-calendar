function bool(value, fallback = false) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const host = process.env.HOST || '127.0.0.1'

const config = {
  // API_PORT wins over PORT: some hosts inject PORT to mean "the port for the
  // app being launched", which would otherwise make the API steal the UI's port.
  port: Number(process.env.API_PORT || process.env.PORT || 3000),
  // Bind to loopback by default: this is a single-user self-hosted tool, and
  // binding 0.0.0.0 with an empty API_KEY would expose every route.
  host,
  isLoopback: ['127.0.0.1', 'localhost', '::1'].includes(host),
  apiKey: process.env.API_KEY || '',
  // Default to the Vite dev origin rather than "*", so a stray browser tab
  // can't drive the API when no key is configured.
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  activeProviders: (process.env.PROVIDERS || 'local')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  google: {
    enabled: bool(process.env.GOOGLE_ENABLED),
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/api/auth/google/callback`,
  },
  outlook: {
    enabled: bool(process.env.OUTLOOK_ENABLED),
    tenant: process.env.OUTLOOK_TENANT || 'common',
    clientId: process.env.OUTLOOK_CLIENT_ID || '',
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
    redirectUri:
      process.env.OUTLOOK_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/api/auth/outlook/callback`,
  },
  caldav: {
    enabled: bool(process.env.CALDAV_ENABLED),
    baseUrl: process.env.CALDAV_URL || '',
    username: process.env.CALDAV_USERNAME || '',
    password: process.env.CALDAV_PASSWORD || '',
  },
}

export default config
