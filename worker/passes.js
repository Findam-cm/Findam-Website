// Access pass: a member pays once with Mobile Money (MeSomb collect) and can then unlock the contact
// and exact location of up to N homes of their choice, until the pass expires.
//
// Levels (see src/category.js): Rooms 10,000 / Studio 15,000 / Apartment 20,000 FCFA by default.
// A pass covers its own category and smaller ones; it can be upgraded later by paying the difference.
//
// Settings (Worker vars or secrets): ACCESS_PASS_FCFA, ACCESS_PASS_STUDIO_FCFA, ACCESS_PASS_APARTMENT_FCFA,
// ACCESS_PASS_HOURS (default 48), ACCESS_PASS_HOMES (default 4).
import { checkTransactions, collect, localNumber, mesombConfigured, transactionStatus } from './mesomb.js'
import { activePassesWithHomes, applyUpgrade, createPass, latestPass, settlePass } from './db.js'
import { CATEGORIES, passFees } from '../src/category.js'

export function passSettings(env) {
  const hours = Math.round(Number(env.ACCESS_PASS_HOURS))
  const homes = Math.round(Number(env.ACCESS_PASS_HOMES))
  const fees = passFees(env)
  return {
    fee: fees.room,
    fees,
    hours: Number.isFinite(hours) && hours >= 1 && hours <= 24 * 31 ? hours : 48,
    homes: Number.isFinite(homes) && homes >= 1 && homes <= 100 ? homes : 4,
  }
}

export function passView(pass) {
  if (!pass) return null
  return { id: pass.id, status: pass.status, kind: pass.kind, tier: pass.tier, amount: pass.amount, hours: pass.hours, maxHomes: pass.max_homes, expiresAt: pass.expires_at, paidAt: pass.paid_at, error: pass.last_error }
}

// Summary of everything the member can see right now: unlocked homes, free slots per level, and when passes end.
export async function passSummary(db, userId) {
  const passes = await activePassesWithHomes(db, userId)
  if (!passes.length) return null
  const list = passes.map((p) => ({ id: p.id, tier: p.tier, expiresAt: p.expires_at, homes: p.homes || [], maxHomes: p.max_homes, free: Math.max(0, p.max_homes - (p.homes || []).length) }))
  // Free slots that can open a home of each category (a higher level also opens smaller homes).
  const slotsFor = {}
  for (const [category, info] of Object.entries(CATEGORIES)) slotsFor[category] = list.filter((p) => (CATEGORIES[p.tier]?.rank || 1) >= info.rank).reduce((sum, p) => sum + p.free, 0)
  const best = list.reduce((top, p) => ((CATEGORIES[p.tier]?.rank || 1) > (CATEGORIES[top]?.rank || 1) ? p.tier : top), 'room')
  return {
    status: 'active',
    homes: list.flatMap((p) => p.homes),
    slotsLeft: list.reduce((sum, p) => sum + p.free, 0),
    slotsFor,
    maxHomes: list.reduce((sum, p) => sum + p.maxHomes, 0),
    tier: best,
    expiresAt: list[list.length - 1].expiresAt,
    passes: list,
  }
}

async function applyResult(db, pass, status, message) {
  if (status === 'SUCCESS') {
    if (pass.kind === 'upgrade') {
      await applyUpgrade(db, pass.id)
      return { ...pass, status: 'applied' }
    }
    return (await settlePass(db, pass.id, 'active')) || pass
  }
  if (status === 'FAILED') return (await settlePass(db, pass.id, 'failed', message || 'The payment was not approved.')) || pass
  return pass
}

function checkPayer(env, service, phone) {
  if (!mesombConfigured(env)) return { error: 'Mobile Money payments are not switched on yet. Please try again later.', status: 503 }
  const payer = localNumber(phone)
  if (!payer) return { error: 'Enter a Cameroon Mobile Money number, for example 677 12 34 56.', status: 400 }
  if (service !== 'MTN' && service !== 'ORANGE') return { error: 'Choose MTN Mobile Money or Orange Money.', status: 400 }
  return { payer }
}

async function pendingBlock(db, userId) {
  const pending = await latestPass(db, userId)
  if (pending?.status === 'pending' && Date.now() - Date.parse(pending.created_at) < 3 * 60 * 1000) {
    return { error: 'A payment is already waiting for your approval. Check your phone.', status: 409, pass: pending }
  }
  return null
}

async function charge(env, db, pass, { amount, service, payer, label }) {
  const result = await collect(env, {
    amount,
    service,
    payer,
    trxID: pass.trx,
    products: [{ name: label, category: 'Access pass', quantity: 1, amount }],
  })
  if (!result.ok) {
    if (result.status >= 400 && result.status < 500) return { pass: await applyResult(db, pass, 'FAILED', result.error) }
    return { pass: (await settlePass(db, pass.id, 'pending', result.error)) || pass }
  }
  return { pass: await applyResult(db, pass, transactionStatus(result.data), result.data?.message || result.data?.transaction?.message) }
}

export async function buyPass(env, db, user, { service, phone, tier }) {
  const ok = checkPayer(env, service, phone)
  if (ok.error) return ok
  const level = CATEGORIES[tier] ? tier : 'room'
  // Do not charge again while the member still has free home slots at this level or higher.
  const current = await passSummary(db, user.id)
  if (current && current.slotsFor[level] > 0) return { pass: { status: 'active', expires_at: current.expiresAt }, alreadyActive: true }
  const blocked = await pendingBlock(db, user.id)
  if (blocked) return blocked
  const { fees, hours, homes } = passSettings(env)
  const trx = `ap${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
  const pass = await createPass(db, { userId: user.id, email: user.email, amount: fees[level], hours, maxHomes: homes, tier: level, kind: 'pass', trx, service, phone: ok.payer })
  return charge(env, db, pass, { amount: fees[level], service, payer: ok.payer, label: `Findam ${CATEGORIES[level].pass}: ${homes} homes for ${hours} hours` })
}

// Raises an active pass (one with free slots) to a higher level for the price difference.
export async function upgradePass(env, db, user, { service, phone, tier }) {
  const ok = checkPayer(env, service, phone)
  if (ok.error) return ok
  if (!CATEGORIES[tier] || tier === 'room') return { error: 'Choose the Studio or Apartment pass.', status: 400 }
  const current = await passSummary(db, user.id)
  const target = current?.passes.filter((p) => p.free > 0 && (CATEGORIES[p.tier]?.rank || 1) < CATEGORIES[tier].rank).sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0]
  if (!target) return { error: 'You have no pass with free homes to upgrade. Buy a new pass instead.', status: 409 }
  const blocked = await pendingBlock(db, user.id)
  if (blocked) return blocked
  const { fees } = passSettings(env)
  const amount = Math.max(0, fees[tier] - fees[target.tier])
  if (amount < 50) return { error: 'This upgrade has no price difference.', status: 400 }
  const trx = `up${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
  const upgrade = await createPass(db, { userId: user.id, email: user.email, amount, hours: 0, maxHomes: 0, tier, kind: 'upgrade', upgrades: target.id, trx, service, phone: ok.payer })
  return charge(env, db, upgrade, { amount, service, payer: ok.payer, label: `Findam pass upgrade to ${CATEGORIES[tier].pass}` })
}

// Re-checks a pass or upgrade that is still waiting for the member to approve on their phone.
export async function refreshPass(env, db, pass) {
  if (!pass || pass.status !== 'pending' || !mesombConfigured(env)) return pass
  const result = await checkTransactions(env, [pass.trx])
  if (!result.ok) return pass
  const list = Array.isArray(result.data) ? result.data : result.data?.results || []
  const found = list.find((item) => [item.trxID, item.external_id, item.reference].includes(pass.trx)) || (list.length === 1 ? list[0] : null)
  if (!found) {
    // Nothing recorded at MeSomb 15 minutes later: the request never reached the phone.
    if (Date.now() - Date.parse(pass.created_at) > 15 * 60 * 1000) return (await settlePass(db, pass.id, 'failed', 'The payment was not completed.')) || pass
    return pass
  }
  return applyResult(db, pass, transactionStatus(found), found.message)
}
