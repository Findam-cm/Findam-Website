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
  await sql`
    CREATE TABLE IF NOT EXISTS referrals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      user_email text NOT NULL,
      kind text NOT NULL,
      contact_name text NOT NULL,
      phone text NOT NULL,
      phone_key text NOT NULL,
      city text NOT NULL,
      neighbourhood text NOT NULL,
      detail text NOT NULL DEFAULT '',
      credits int NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (kind, phone_key)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      delta int NOT NULL,
      reason text NOT NULL,
      referral_id uuid REFERENCES referrals (id),
      listing_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS listing_unlocks (
      user_id text NOT NULL,
      listing_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, listing_id)
    )
  `
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer_phone text NOT NULL DEFAULT ''`
  await sql`
    CREATE TABLE IF NOT EXISTS search_alerts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      filters jsonb NOT NULL,
      label text NOT NULL,
      seen_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  readyFor = databaseUrl
}

export const MAX_ALERTS = 10

export async function listAlerts(databaseUrl, userId) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  return sql`
    SELECT id, filters, label, seen_at, created_at
    FROM search_alerts
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
}

export async function addAlert(databaseUrl, userId, filters, label) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const rows = await sql`
    INSERT INTO search_alerts (user_id, filters, label)
    SELECT ${userId}, ${JSON.stringify(filters)}::jsonb, ${label}
    WHERE (SELECT count(*) FROM search_alerts WHERE user_id = ${userId}) < ${MAX_ALERTS}
    RETURNING id, filters, label, seen_at, created_at
  `
  if (!rows.length) return { error: `You can keep up to ${MAX_ALERTS} alerts. Delete one first.`, status: 409 }
  return { alert: rows[0] }
}

export async function deleteAlert(databaseUrl, userId, alertId) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const rows = await sql`DELETE FROM search_alerts WHERE id = ${String(alertId)} AND user_id = ${userId} RETURNING id`
  if (!rows.length) return { error: 'That alert was not found.', status: 404 }
  return { ok: true }
}

export async function markAlertsSeen(databaseUrl, userId) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  await sql`UPDATE search_alerts SET seen_at = now() WHERE user_id = ${userId}`
  return { ok: true }
}

function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '')
}

// A member's landlord referrals and their review status. (The old credit system has been removed.)
export async function memberAccount(databaseUrl, userId) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const referrals = await sql`
    SELECT id, kind, contact_name, phone, city, neighbourhood, detail, status, created_at
    FROM referrals
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
  return { referrals }
}

// Referral programme: members refer landlords. Findam reviews each one and rewards the member
// when the landlord's homes are listed or let through Findam.
export async function addReferral(databaseUrl, user, input) {
  const contactName = String(input.contactName || '').trim().slice(0, 80)
  const phone = String(input.phone || '').trim().slice(0, 20)
  const city = String(input.city || '').trim()
  const neighbourhood = String(input.neighbourhood || '').trim().slice(0, 80)
  const detail = String(input.detail || '').trim().slice(0, 300)
  const referrerPhone = String(input.referrerPhone || '').trim().slice(0, 20)
  const key = phoneKey(phone)
  if (contactName.length < 2 || key.length < 8 || !input.cities?.includes(city) || neighbourhood.length < 2) {
    return { error: 'Add the landlord’s name, a reachable phone number, the city and the neighbourhood.', status: 400 }
  }
  if (phoneKey(referrerPhone).length < 8) return { error: 'Add your own phone number so we can reach you about your reward.', status: 400 }
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  let created
  try {
    created = await sql`
      INSERT INTO referrals (user_id, user_email, kind, contact_name, phone, phone_key, city, neighbourhood, detail, credits, referrer_phone)
      VALUES (${user.id}, ${user.email}, 'landlord', ${contactName}, ${phone}, ${key}, ${city}, ${neighbourhood}, ${detail}, 0, ${referrerPhone})
      RETURNING id, kind, contact_name, phone, city, neighbourhood, detail, status, created_at
    `
  } catch (error) {
    if (error?.code === '23505') return { error: 'This landlord has already been referred to Findam.', status: 409 }
    throw error
  }
  const account = await memberAccount(databaseUrl, user.id)
  return { referral: created[0], ...account }
}

export async function listPendingReferrals(databaseUrl) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  return sql`
    SELECT id, kind, contact_name, phone, city, neighbourhood, detail, referrer_phone, user_email, created_at
    FROM referrals
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `
}

export async function reviewReferral(databaseUrl, referralId, decision) {
  const id = String(referralId || '').trim()
  if (decision !== 'accepted' && decision !== 'rejected') return { error: 'Choose accept or reject.', status: 400 }
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const updated = await sql`UPDATE referrals SET status = ${decision} WHERE id = ${id} AND status = 'pending' RETURNING id`
  if (!updated.length) {
    const rows = await sql`SELECT id FROM referrals WHERE id = ${id}`
    return rows.length ? { error: 'This referral has already been reviewed.', status: 409 } : { error: 'That referral was not found.', status: 404 }
  }
  return { ok: true, status: decision }
}

export async function addActivity(databaseUrl, note) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const rows = await sql`INSERT INTO activity (note) VALUES (${note}) RETURNING id, note, created_at`
  const counts = await sql`SELECT count(*)::int AS count FROM activity`
  return { row: rows[0], count: counts[0].count }
}

export async function findAuthUserById(databaseUrl, userId) {
  const id = String(userId || '').trim()
  if (!databaseUrl || id.length < 8 || id.length > 80) return null
  const sql = client(databaseUrl)
  const rows = await sql`
    SELECT id, email, name
    FROM neon_auth."user"
    WHERE id = ${id}
      AND banned IS NOT TRUE
  `
  if (!rows[0]?.id || !rows[0]?.email) return null
  return { id: String(rows[0].id), email: String(rows[0].email), name: String(rows[0].name || '') }
}

export async function findAuthUser(databaseUrl, token) {
  const value = String(token || '').trim()
  if (!databaseUrl || value.length < 8) return null
  const candidates = [value]
  const dot = value.lastIndexOf('.')
  if (dot > 1) {
    const signature = value.slice(dot + 1)
    if (signature.length === 44 && signature.endsWith('=')) candidates.push(value.slice(0, dot))
  }
  const sql = client(databaseUrl)
  for (const candidate of candidates) {
    const rows = await sql`
      SELECT u.id, u.email, u.name
      FROM neon_auth.session s
      JOIN neon_auth."user" u ON u.id = s."userId"
      WHERE s.token = ${candidate}
        AND s."expiresAt" > now()
        AND u.banned IS NOT TRUE
    `
    if (rows[0]?.id && rows[0]?.email) {
      return { id: String(rows[0].id), email: String(rows[0].email), name: String(rows[0].name || '') }
    }
  }
  return null
}

export async function countAuthUsers(databaseUrl) {
  const sql = client(databaseUrl)
  const rows = await sql`SELECT count(*)::int AS count FROM neon_auth."user"`
  return rows[0]?.count ?? 0
}
