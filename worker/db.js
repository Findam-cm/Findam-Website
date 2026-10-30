import { neon } from '@neondatabase/serverless'

let readyFor = ''

export function databaseName(databaseUrl) {
  const path = String(databaseUrl || '').split('?')[0]
  return path.split('/').pop() || 'neondb'
}

function client(databaseUrl) {
  return neon(databaseUrl, { fetchOptions: { signal: AbortSignal.timeout(20000) } })
}

export async function checkPostgres(databaseUrl) {
  if (!databaseUrl) return 'missing'
  try {
    const sql = client(databaseUrl)
    await ensureTables(sql, databaseUrl)
    await sql`SELECT 1 AS ok`
    return 'connected'
  } catch {
    return 'unavailable'
  }
}

async function ensureTables(sql, databaseUrl) {
  if (readyFor === databaseUrl) return
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      name text NOT NULL,
      role text NOT NULL DEFAULT 'seeker',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash text UNIQUE NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS activity (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      note text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  readyFor = databaseUrl
}

export async function addActivity(databaseUrl, note) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const rows = await sql`INSERT INTO activity (note) VALUES (${note}) RETURNING id, note, created_at`
  const counts = await sql`SELECT count(*)::int AS count FROM activity`
  return { row: rows[0], count: counts[0].count }
}

export async function countAuthUsers(databaseUrl) {
  const sql = client(databaseUrl)
  const rows = await sql`SELECT count(*)::int AS count FROM neon_auth."user"`
  return rows[0]?.count ?? 0
}
