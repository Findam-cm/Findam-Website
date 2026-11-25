// Access pass: a member pays once with Mobile Money (MeSomb collect) and can then unlock the contact
// and exact location of up to N homes of their choice, until the pass expires.
//
// Settings (Worker vars or secrets): ACCESS_PASS_FCFA (default 10000), ACCESS_PASS_HOURS (default 48),
// ACCESS_PASS_HOMES (default 4).
import { checkTransactions, collect, localNumber, mesombConfigured, transactionStatus } from './mesomb.js'
import { activePassesWithHomes, createPass, latestPass, settlePass } from './db.js'

export function passSettings(env) {
  const fee = Math.round(Number(env.ACCESS_PASS_FCFA))
  const hours = Math.round(Number(env.ACCESS_PASS_HOURS))
  const homes = Math.round(Number(env.ACCESS_PASS_HOMES))
  return {
    fee: Number.isFinite(fee) && fee >= 50 ? fee : 10000,
    hours: Number.isFinite(hours) && hours >= 1 && hours <= 24 * 31 ? hours : 48,
    homes: Number.isFinite(homes) && homes >= 1 && homes <= 100 ? homes : 4,
  }
}

export function passView(pass) {
  if (!pass) return null
  return { id: pass.id, status: pass.status, amount: pass.amount, hours: pass.hours, maxHomes: pass.max_homes, expiresAt: pass.expires_at, paidAt: pass.paid_at, error: pass.last_error }
}

// Summary of everything the member can see right now: unlocked homes, free slots, and when each pass ends.
export async function passSummary(db, userId) {
  const passes = await activePassesWithHomes(db, userId)
  if (!passes.length) return null
  const homes = passes.flatMap((p) => p.homes || [])
  const slots = passes.reduce((sum, p) => sum + Math.max(0, p.max_homes - (p.homes || []).length), 0)
  const withRoom = passes.find((p) => (p.homes || []).length < p.max_homes)
  return {
    status: 'active',
    homes,
    slotsLeft: slots,
    maxHomes: passes.reduce((sum, p) => sum + p.max_homes, 0),
    // Countdown shows the pass that ends last; unlocked homes each end with their own pass.
    expiresAt: passes[passes.length - 1].expires_at,
    nextSlotExpiresAt: withRoom?.expires_at || null,
    passes: passes.map((p) => ({ id: p.id, expiresAt: p.expires_at, homes: p.homes || [], maxHomes: p.max_homes })),
  }
}

async function applyResult(db, pass, status, message) {
  if (status === 'SUCCESS') return (await settlePass(db, pass.id, 'active')) || pass
  if (status === 'FAILED') return (await settlePass(db, pass.id, 'failed', message || 'The payment was not approved.')) || pass
  return pass
}

export async function buyPass(env, db, user, { service, phone }) {
  if (!mesombConfigured(env)) return { error: 'Mobile Money payments are not switched on yet. Please try again later.', status: 503 }
  const payer = localNumber(phone)
  if (!payer) return { error: 'Enter a Cameroon Mobile Money number, for example 677 12 34 56.', status: 400 }
  if (service !== 'MTN' && service !== 'ORANGE') return { error: 'Choose MTN Mobile Money or Orange Money.', status: 400 }
  // Do not charge again while the member still has free home slots on an active pass.
  const current = await passSummary(db, user.id)
  if (current && current.slotsLeft > 0) return { pass: { status: 'active', expires_at: current.expiresAt }, alreadyActive: true }
  const pending = await latestPass(db, user.id)
  if (pending?.status === 'pending' && Date.now() - Date.parse(pending.created_at) < 3 * 60 * 1000) {
    return { error: 'A payment is already waiting for your approval. Check your phone.', status: 409, pass: pending }
  }
  const { fee, hours, homes } = passSettings(env)
  const trx = `ap${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
  const pass = await createPass(db, { userId: user.id, email: user.email, amount: fee, hours, maxHomes: homes, trx, service, phone: payer })
  const result = await collect(env, {
    amount: fee,
    service,
    payer,
    trxID: trx,
    products: [{ name: `Findam access pass: ${homes} homes for ${hours} hours`, category: 'Access pass', quantity: 1, amount: fee }],
  })
  if (!result.ok) {
    if (result.status >= 400 && result.status < 500) return { pass: await applyResult(db, pass, 'FAILED', result.error) }
    return { pass: (await settlePass(db, pass.id, 'pending', result.error)) || pass }
  }
  return { pass: await applyResult(db, pass, transactionStatus(result.data), result.data?.message || result.data?.transaction?.message) }
}

// Re-checks a pass that is still waiting for the member to approve on their phone.
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
