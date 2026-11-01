import fs from 'node:fs'

const text = fs.readFileSync('.env', 'utf8')
const map = new Map()
for (const line of text.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const index = line.indexOf('=')
  if (index > 0) map.set(line.slice(0, index), line.slice(index + 1))
}

const serverKeys = [
  'DATABASE_URL',
  'NEON_AUTH_BASE_URL',
  'NEON_AUTH_JWKS_URL',
  'NEON_FUNCTION_HELLO_BASE_URL',
  'NEON_REALTIME_URL',
  'NEON_REALTIME_SECRET',
]
const missing = serverKeys.filter((key) => !map.get(key))
if (missing.length) {
  console.error('missing ' + missing.join(', '))
  process.exit(1)
}

const adminEmailKeys = ['EMAIL', 'ADMIN_EMAIL', 'ROOT_ADMIN_EMAIL'].filter((key) => String(map.get(key) || '').trim())
const api = [
  '# Wrangler reads this file. Keep admin passwords out of it.',
  ...serverKeys.map((key) => `${key}=${map.get(key)}`),
  ...adminEmailKeys.map((key) => `${key}=${map.get(key)}`),
  '',
].join('\n')
fs.writeFileSync('.env.api', api)

const publishable = [
  ['VITE_NEON_AUTH_URL', 'NEON_AUTH_BASE_URL'],
  ['VITE_NEON_REALTIME_URL', 'NEON_REALTIME_URL'],
]
let env = text.endsWith('\n') ? text : `${text}\n`
for (const [target, source] of publishable) {
  const pattern = new RegExp(`^${target}=.*$`, 'm')
  const line = `${target}=${map.get(source)}`
  env = pattern.test(env) ? env.replace(pattern, line) : `${env}${line}\n`
}
fs.writeFileSync('.env', env)
console.log('synced ' + [...serverKeys, ...publishable.map(([key]) => key)].join(', '))
