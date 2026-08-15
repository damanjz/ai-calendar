function bool(value, fallback = false) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const config = {
  port: Number(process.env.PORT || 3000),
  apiKey: process.env.API_KEY || '',
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
