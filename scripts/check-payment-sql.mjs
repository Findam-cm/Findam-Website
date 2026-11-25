// Dry-run check of the payment SQL against the real database. Everything runs inside one
// transaction that is ROLLED BACK at the end, so nothing is saved.
// Usage (from the Findam-Website folder): node scripts/check-payment-sql.mjs
import fs from 'node:fs'
import { Client, neonConfig } from '@neondatabase/serverless'

neonConfig.webSocketConstructor = globalThis.WebSocket
const env = Object.fromEntries(fs.readFileSync('.env.api', 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]))
const client = new Client(env.DATABASE_URL)
await client.connect()
let failed = 0
const step = async (name, text, params = [], expect) => {
  try {
    const result = await client.query(text, params)
    const ok = expect ? expect(result.rows) : true
    if (!ok) failed++
    console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(result.rows).slice(0, 200))
    return result.rows
  } catch (error) {
    failed++
    console.log('FAIL', name, '->', error.message)
    return []
  }
}
try {
  await client.query('BEGIN')
  await step('referrals table exists', 'SELECT 1 FROM referrals LIMIT 1')
  await step('add referrer_phone column', "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer_phone text NOT NULL DEFAULT ''")
  await step('create access_passes', `CREATE TABLE IF NOT EXISTS access_passes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, user_email text NOT NULL, amount int NOT NULL, hours int NOT NULL, status text NOT NULL DEFAULT 'pending', trx text UNIQUE NOT NULL, service text NOT NULL, payer_phone text NOT NULL, last_error text, created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz, expires_at timestamptz)`)
  await step('create index', 'CREATE INDEX IF NOT EXISTS access_passes_user ON access_passes (user_id, expires_at DESC)')
  await step('create referral_rewards', `CREATE TABLE IF NOT EXISTS referral_rewards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text UNIQUE NOT NULL, referral_id uuid NOT NULL REFERENCES referrals (id), listing_id text NOT NULL, listing_title text NOT NULL DEFAULT '', amount int NOT NULL, landlord_phone text NOT NULL, referrer_phone text NOT NULL, referrer_email text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'requested', collect_attempts int NOT NULL DEFAULT 0, collect_trx text, collect_service text, payer_phone text, payout_attempts int NOT NULL DEFAULT 0, payout_trx text, payout_service text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz, completed_at timestamptz, UNIQUE (referral_id, listing_id))`)

  const pass = await step('insert pass', 'INSERT INTO access_passes (user_id, user_email, amount, hours, trx, service, payer_phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', ['qa-user', 'qa@example.com', 1000, 24, 'apqa' + Date.now(), 'MTN', '677000000'], (rows) => rows.length === 1)
  await step('activate pass for 24 h', "UPDATE access_passes SET status = 'active', paid_at = now(), expires_at = now() + make_interval(hours => hours), last_error = NULL WHERE id = $1 AND status = 'pending' RETURNING expires_at, round(extract(epoch from (expires_at - now())) / 3600) AS h", [pass[0]?.id], (rows) => Number(rows[0]?.h) === 24)
  await step('activating twice is refused', "UPDATE access_passes SET status = 'active' WHERE id = $1 AND status = 'pending' RETURNING id", [pass[0]?.id], (rows) => rows.length === 0)
  await step('active pass lookup', "SELECT id FROM access_passes WHERE user_id = $1 AND status = 'active' AND expires_at > now() ORDER BY expires_at DESC LIMIT 1", ['qa-user'], (rows) => rows.length === 1)
  await step('add max_homes column', 'ALTER TABLE access_passes ADD COLUMN IF NOT EXISTS max_homes int NOT NULL DEFAULT 4')
  await step('create pass_unlocks', 'CREATE TABLE IF NOT EXISTS pass_unlocks (pass_id uuid NOT NULL REFERENCES access_passes (id), user_id text NOT NULL, listing_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (pass_id, listing_id))')
  // Same statement as unlockHome() in worker/db.js.
  const unlock = `INSERT INTO pass_unlocks (pass_id, user_id, listing_id)
      SELECT a.id, $1, $2 FROM access_passes a
      WHERE a.user_id = $1 AND a.status = 'active' AND a.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM pass_unlocks u JOIN access_passes b ON b.id = u.pass_id WHERE u.user_id = $1 AND u.listing_id = $2 AND b.status = 'active' AND b.expires_at > now())
        AND (SELECT count(*) FROM pass_unlocks u WHERE u.pass_id = a.id) < a.max_homes
      ORDER BY a.expires_at ASC LIMIT 1 RETURNING pass_id`
  for (const home of ['h1', 'h2', 'h3', 'h4']) await step(`unlock home ${home}`, unlock, ['qa-user', home], (rows) => rows.length === 1)
  await step('5th home is refused (limit 4)', unlock, ['qa-user', 'h5'], (rows) => rows.length === 0)
  await step('unlocking the same home again uses no slot', unlock, ['qa-user', 'h2'], (rows) => rows.length === 0)
  await step('summary query lists 4 homes', `SELECT a.max_homes, coalesce((SELECT array_agg(u.listing_id ORDER BY u.created_at) FROM pass_unlocks u WHERE u.pass_id = a.id), '{}') AS homes FROM access_passes a WHERE a.user_id = $1 AND a.status = 'active' AND a.expires_at > now() ORDER BY a.expires_at ASC`, ['qa-user'], (rows) => rows[0]?.homes?.length === 4 && rows[0]?.max_homes === 4)
  // Pass levels: rooms (1) < studio (2) < apartment (3).
  await step('add tier/kind/upgrades columns', "ALTER TABLE access_passes ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'room', ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pass', ADD COLUMN IF NOT EXISTS upgrades uuid")
  const rank = "CASE a.tier WHEN 'apartment' THEN 3 WHEN 'studio' THEN 2 ELSE 1 END"
  const unlockRanked = `INSERT INTO pass_unlocks (pass_id, user_id, listing_id)
      SELECT a.id, $1, $2 FROM access_passes a
      WHERE a.user_id = $1 AND a.kind = 'pass' AND a.status = 'active' AND a.expires_at > now() AND ${rank} >= $3
        AND NOT EXISTS (SELECT 1 FROM pass_unlocks u JOIN access_passes b ON b.id = u.pass_id WHERE u.user_id = $1 AND u.listing_id = $2 AND b.status = 'active' AND b.expires_at > now())
        AND (SELECT count(*) FROM pass_unlocks u WHERE u.pass_id = a.id) < a.max_homes
      ORDER BY ${rank} ASC, a.expires_at ASC LIMIT 1 RETURNING pass_id`
  const p2 = await step('new rooms pass', "INSERT INTO access_passes (user_id, user_email, amount, hours, max_homes, tier, trx, service, payer_phone, status, paid_at, expires_at) VALUES ('qa-2','qa2@example.com',10000,48,4,'room','apqa2-'||extract(epoch from now()),'MTN','677000000','active',now(),now()+interval '48 hours') RETURNING id", [], (rows) => rows.length === 1)
  await step('rooms pass unlocks a room', unlockRanked, ['qa-2', 'room-1', 1], (rows) => rows.length === 1)
  await step('rooms pass cannot unlock an apartment', unlockRanked, ['qa-2', 'apt-1', 3], (rows) => rows.length === 0)
  await step('rooms pass cannot unlock a studio', unlockRanked, ['qa-2', 'studio-1', 2], (rows) => rows.length === 0)
  const up = await step('record upgrade payment', "INSERT INTO access_passes (user_id, user_email, amount, hours, max_homes, tier, kind, upgrades, trx, service, payer_phone) VALUES ('qa-2','qa2@example.com',10000,0,0,'apartment','upgrade',$1,'upqa2-'||extract(epoch from now()),'MTN','677000000') RETURNING id", [p2[0]?.id], (rows) => rows.length === 1)
  const applyUpgrade = `WITH u AS (UPDATE access_passes SET status = 'applied', paid_at = now(), last_error = NULL WHERE id = $1 AND kind = 'upgrade' AND status = 'pending' RETURNING upgrades, tier)
    UPDATE access_passes p SET tier = u.tier FROM u WHERE p.id = u.upgrades
      AND (CASE u.tier WHEN 'apartment' THEN 3 WHEN 'studio' THEN 2 ELSE 1 END) > (CASE p.tier WHEN 'apartment' THEN 3 WHEN 'studio' THEN 2 ELSE 1 END)
    RETURNING p.id, p.tier`
  await step('upgrade applies: pass becomes apartment', applyUpgrade, [up[0]?.id], (rows) => rows[0]?.tier === 'apartment')
  await step('upgrade cannot be applied twice', applyUpgrade, [up[0]?.id], (rows) => rows.length === 0)
  await step('upgraded pass now unlocks the apartment', unlockRanked, ['qa-2', 'apt-1', 3], (rows) => rows.length === 1)
  await step('upgrade row never counts as a pass', "SELECT count(*)::int AS n FROM access_passes a WHERE a.user_id = 'qa-2' AND a.kind = 'pass' AND a.status = 'active'", [], (rows) => rows[0].n === 1)
  await client.query("UPDATE access_passes SET expires_at = now() - interval '1 second' WHERE user_id = 'qa-user'")
  await step('after expiry nothing can be unlocked', unlock, ['qa-user', 'h6'], (rows) => rows.length === 0)
  await step('after expiry no active pass remains', "SELECT id FROM access_passes WHERE user_id = 'qa-user' AND status = 'active' AND expires_at > now()", [], (rows) => rows.length === 0)

  const ref = await step('insert test referral', "INSERT INTO referrals (user_id, user_email, kind, contact_name, phone, phone_key, city, neighbourhood, detail, credits, referrer_phone) VALUES ('qa-user','qa@example.com','landlord','QA Landlord','+237 677 999 888','237677999888','Buea','Molyko','',0,'699111222') RETURNING id", [], (rows) => rows.length === 1)
  await client.query("UPDATE referrals SET status = 'accepted' WHERE id = $1", [ref[0]?.id])
  await step('match landlord by phone (with and without 237)', "SELECT id FROM referrals WHERE kind = 'landlord' AND status = 'accepted' AND (phone_key = $1 OR phone_key = $2 OR right(phone_key, 9) = $3) ORDER BY created_at ASC LIMIT 1", ['677999888', '237677999888', '677999888'], (rows) => rows[0]?.id === ref[0]?.id)
  const rw = await step('create reward', "INSERT INTO referral_rewards (token, referral_id, listing_id, listing_title, amount, landlord_phone, referrer_phone, referrer_email) VALUES ($1,$2,'L1','Room',5000,'677999888','699111222','qa@example.com') RETURNING id", ['f'.repeat(48), ref[0]?.id], (rows) => rows.length === 1)
  await client.query('SAVEPOINT s1')
  try {
    await client.query("INSERT INTO referral_rewards (token, referral_id, listing_id, amount, landlord_phone, referrer_phone) VALUES ($1,$2,'L1',5000,'1','2')", ['e'.repeat(48), ref[0]?.id])
    failed++
    console.log('FAIL duplicate reward refused -> it was accepted')
  } catch (error) {
    console.log(error.code === '23505' ? 'PASS duplicate reward refused (unique)' : `FAIL duplicate reward -> ${error.message}`)
    if (error.code !== '23505') failed++
  }
  await client.query('ROLLBACK TO SAVEPOINT s1')
  const transition = `UPDATE referral_rewards SET status = $2,
      collect_attempts = coalesce($4::int, collect_attempts), collect_trx = coalesce($5, collect_trx), collect_service = coalesce($6, collect_service), payer_phone = coalesce($7, payer_phone),
      payout_attempts = coalesce($8::int, payout_attempts), payout_trx = coalesce($9, payout_trx), payout_service = coalesce($10, payout_service),
      last_error = $11, paid_at = coalesce($12::timestamptz, paid_at), completed_at = coalesce($13::timestamptz, completed_at)
    WHERE id = $1 AND status = ANY($3) RETURNING status, collect_attempts, collect_trx`
  await step('transition requested -> collecting', transition, [rw[0]?.id, 'collecting', ['requested', 'collect_failed'], 1, 'abcc1', 'MTN', '677999888', null, null, null, null, null, null], (rows) => rows[0]?.status === 'collecting' && rows[0]?.collect_attempts === 1)
  await step('wrong starting status is refused', transition, [rw[0]?.id, 'collecting', ['requested'], 2, null, null, null, null, null, null, null, null, null], (rows) => rows.length === 0)
  await step('member account with rewards', `SELECT r.id, coalesce((SELECT json_agg(json_build_object('amount', w.amount, 'status', w.status) ORDER BY w.created_at) FROM referral_rewards w WHERE w.referral_id = r.id AND w.status <> 'cancelled'), '[]'::json) AS rewards FROM referrals r WHERE r.user_id = 'qa-user'`, [], (rows) => rows[0]?.rewards?.[0]?.amount === 5000)
} finally {
  await client.query('ROLLBACK')
  const left = await client.query("SELECT to_regclass('public.access_passes') AS t, (SELECT count(*) FROM referrals WHERE user_id = 'qa-user')::int AS refs")
  console.log('after rollback: access_passes table =', left.rows[0].t, '| test referrals left =', left.rows[0].refs)
  await client.end()
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED (nothing was saved)')
process.exit(failed ? 1 : 0)
