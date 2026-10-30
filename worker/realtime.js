import { createRealtime, rawSql } from '@neon/realtime/server'
import { databaseName } from './db.js'

export async function sealActivity(env) {
  if (!env.NEON_REALTIME_SECRET || !env.DATABASE_URL) return null
  const realtime = createRealtime({
    secret: env.NEON_REALTIME_SECRET,
    db: databaseName(env.DATABASE_URL),
  })
  return realtime.seal({
    query: rawSql('SELECT id, note, created_at FROM activity ORDER BY created_at, id'),
  })
}
