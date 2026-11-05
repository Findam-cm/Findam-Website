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
  readyFor = databaseUrl
}

export const CREDIT_RULES = {
  property: 2,
  landlord: 3,
  freeAt: 5,
  unlockCost: 1,
}

function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '')
}

export async function creditAccount(databaseUrl, userId) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const totals = await sql`SELECT coalesce(sum(delta), 0)::int AS score FROM credit_ledger WHERE user_id = ${userId}`
  const referrals = await sql`
    SELECT id, kind, contact_name, phone, city, neighbourhood, detail, credits, status, created_at
    FROM referrals
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
  const unlocks = await sql`SELECT listing_id FROM listing_unlocks WHERE user_id = ${userId}`
  const score = totals[0]?.score ?? 0
  const pendingCredits = referrals
    .filter((row) => row.status === 'pending')
    .reduce((sum, row) => sum + Number(row.credits || 0), 0)
  return {
    score,
    pendingCredits,
    freeFinder: score >= CREDIT_RULES.freeAt,
    freeAt: CREDIT_RULES.freeAt,
    rules: CREDIT_RULES,
    referrals,
    unlocked: unlocks.map((row) => row.listing_id),
  }
}

export async function addReferral(databaseUrl, user, input) {
  const kind = input.kind === 'landlord' ? 'landlord' : input.kind === 'property' ? 'property' : ''
  const contactName = String(input.contactName || '').trim().slice(0, 80)
  const phone = String(input.phone || '').trim().slice(0, 20)
  const city = String(input.city || '').trim()
  const neighbourhood = String(input.neighbourhood || '').trim().slice(0, 80)
  const detail = String(input.detail || '').trim().slice(0, 240)
  const key = phoneKey(phone)
  if (!kind || contactName.length < 2 || key.length < 8 || !input.cities?.includes(city) || neighbourhood.length < 2) {
    return { error: 'Add the name, a reachable phone number, the city, and the neighbourhood.', status: 400 }
  }
  const credits = CREDIT_RULES[kind]
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  let created
  try {
    created = await sql`
      INSERT INTO referrals (user_id, user_email, kind, contact_name, phone, phone_key, city, neighbourhood, detail, credits)
      VALUES (${user.id}, ${user.email}, ${kind}, ${contactName}, ${phone}, ${key}, ${city}, ${neighbourhood}, ${detail}, ${credits})
      RETURNING id, kind, contact_name, phone, city, neighbourhood, detail, credits, status, created_at
    `
  } catch (error) {
    if (error?.code === '23505') return { error: 'That phone number has already been referred.', status: 409 }
    throw error
  }
  const account = await creditAccount(databaseUrl, user.id)
  return { referral: created[0], ...account }
}

export async function listPendingReferrals(databaseUrl) {
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  return sql`
    SELECT id, kind, contact_name, phone, city, neighbourhood, detail, credits, user_email, created_at
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
  const rows = await sql`SELECT id, user_id, kind, credits, status FROM referrals WHERE id = ${id}`
  const referral = rows[0]
  if (!referral) return { error: 'That referral was not found.', status: 404 }
  if (referral.status !== 'pending') return { error: 'This referral has already been reviewed.', status: 409 }
  if (decision === 'rejected') {
    const updated = await sql`UPDATE referrals SET status = 'rejected' WHERE id = ${id} AND status = 'pending' RETURNING id`
    if (!updated.length) return { error: 'This referral has already been reviewed.', status: 409 }
    return { ok: true, status: 'rejected' }
  }
  const updated = await sql`
    WITH accepted AS (
      UPDATE referrals SET status = 'accepted'
      WHERE id = ${id} AND status = 'pending'
      RETURNING id, user_id, kind, credits
    )
    INSERT INTO credit_ledger (user_id, delta, reason, referral_id)
    SELECT user_id, credits,
      CASE WHEN kind = 'landlord' THEN 'Referred a landlord' ELSE 'Referred a property' END,
      id
    FROM accepted
    RETURNING delta
  `
  if (!updated.length) return { error: 'This referral has already been reviewed.', status: 409 }
  return { ok: true, status: 'accepted', credits: updated[0].delta }
}

export async function openListingContact(databaseUrl, userId, listingId) {
  const id = String(listingId || '').trim().slice(0, 80)
  if (!id) return { error: 'Choose a property first.', status: 400 }
  const sql = client(databaseUrl)
  await ensureTables(sql, databaseUrl)
  const results = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`,
    sql`
      INSERT INTO credit_ledger (user_id, delta, reason, listing_id)
      SELECT ${userId}, ${-CREDIT_RULES.unlockCost}, ${'Opened a property contact'}, ${id}
      WHERE NOT EXISTS (
        SELECT 1 FROM listing_unlocks WHERE user_id = ${userId} AND listing_id = ${id}
      )
      AND (SELECT coalesce(sum(delta), 0)::int FROM credit_ledger WHERE user_id = ${userId}) >= ${CREDIT_RULES.unlockCost}
      AND (SELECT coalesce(sum(delta), 0)::int FROM credit_ledger WHERE user_id = ${userId}) < ${CREDIT_RULES.freeAt}
      RETURNING id
    `,
    sql`
      INSERT INTO listing_unlocks (user_id, listing_id)
      SELECT ${userId}, ${id}
      WHERE EXISTS (
        SELECT 1 FROM listing_unlocks WHERE user_id = ${userId} AND listing_id = ${id}
      )
      OR (SELECT coalesce(sum(delta), 0)::int FROM credit_ledger WHERE user_id = ${userId}) >= ${CREDIT_RULES.freeAt}
      OR EXISTS (
        SELECT 1 FROM credit_ledger
        WHERE user_id = ${userId} AND listing_id = ${id} AND delta = ${-CREDIT_RULES.unlockCost}
      )
      ON CONFLICT DO NOTHING
      RETURNING listing_id
    `,
    sql`
      SELECT listing_id FROM listing_unlocks
      WHERE user_id = ${userId} AND listing_id = ${id}
    `,
    sql`SELECT coalesce(sum(delta), 0)::int AS score FROM credit_ledger WHERE user_id = ${userId}`,
  ])
  const opened = results[3]
  const totals = results[4]
  const score = totals[0]?.score ?? 0
  const freeFinder = score >= CREDIT_RULES.freeAt
  if (!opened.length) {
    return { error: 'Refer a property or a landlord to earn credits before opening a contact.', status: 402, score, freeFinder }
  }
  return { ok: true, score, freeFinder, listingId: id }
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
