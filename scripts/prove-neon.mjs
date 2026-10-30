import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { createRealtime, rawSql } from '@neon/realtime/server'

function load(file) {
  const map = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index > 0) map.set(line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, ''))
  }
  return map
}

const env = load('.env.api')
const note = `proof-${Date.now()}`

const hello = await fetch(env.get('NEON_FUNCTION_HELLO_BASE_URL'), { signal: AbortSignal.timeout(20000) })
const helloText = await hello.text()
console.log(`functions status=${hello.status} body=${JSON.stringify(helloText)}`)

const jwks = await fetch(env.get('NEON_AUTH_JWKS_URL'), { signal: AbortSignal.timeout(20000) })
const jwksBody = await jwks.json()
console.log(`auth jwks status=${jwks.status} keys=${Array.isArray(jwksBody.keys) ? jwksBody.keys.length : 0}`)

const sql = neon(env.get('DATABASE_URL'), { fetchOptions: { signal: AbortSignal.timeout(20000) } })
await sql`CREATE TABLE IF NOT EXISTS activity (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`
const inserted = await sql`INSERT INTO activity (note) VALUES (${note}) RETURNING note`
const counted = await sql`SELECT count(*)::int AS count FROM activity`
console.log(`postgres inserted=${inserted[0]?.note === note} count=${counted[0]?.count}`)

let authUsers = 'missing'
try {
  const rows = await sql`SELECT count(*)::int AS count FROM neon_auth."user"`
  authUsers = String(rows[0]?.count ?? 0)
} catch (error) {
  authUsers = error?.code || 'unavailable'
}
console.log(`auth users=${authUsers}`)

const database = env.get('DATABASE_URL').split('?')[0].split('/').pop()
const realtime = createRealtime({ secret: env.get('NEON_REALTIME_SECRET'), db: database })
const sealed = await realtime.seal({ query: rawSql('SELECT id, note, created_at FROM activity ORDER BY created_at, id') })
console.log(`realtime sealed=${Boolean(sealed && typeof sealed === 'object')}`)
