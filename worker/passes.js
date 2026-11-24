// Access pass: a member pays once with Mobile Money (MeSomb collect) and can see every listing's
// contact and exact location until the pass expires (24 hours by default).
//
// Settings (Worker vars or secrets): ACCESS_PASS_FCFA (default 1000), ACCESS_PASS_HOURS (default 24).
import { checkTransactions, collect, localNumber, mesombConfigured, transactionStatus } from './mesomb.js'
import { activePass, createPass, latestPass, settlePass } from './db.js'

export function passSettings(env) {
  const fee = Math.round(Number(env.ACCESS_PASS_FCFA))
  const hours = Math.round(Number(env.ACCESS_PASS_HOURS))
  return {
    fee: Number.isFinite(fee) && fee >= 50 ? fee : 1000,
    hours: Number.isFinite(hours) && hours >= 1 && hours <= 24 * 31 ? hours : 24,
  }
}

export function passView(pass) {
  if (!pass) return null
  return { id: pass.id, status: pass.status, amount: pass.amount, hours: pass.hours, expiresAt: pass.expires_at, paidAt: pass.paid_at, error: pass.last_error }
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
  const current = await activePass(db, user.id)
  if (current) return { pass: current }
  const pending = await latestPass(db, user.id)
  if (pending?.status === 'pending' && Date.now() - Date.parse(pending.created_at) < 3 * 60 * 1000) {
    return { error: 'A payment is already waiting for your approval. Check your phone.', status: 409, pass: pending }
  }
  const { fee, hours } = passSettings(env)
  const trx = `ap${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
  const pass = await createPass(db, { userId: user.id, email: user.email, amount: fee, hours, trx, service, phone: payer })
  const result = await collect(env, {
    amount: fee,
    service,
    payer,
    trxID: trx,
    products: [{ name: `Findam ${hours}-hour access pass`, category: 'Access pass', quantity: 1, amount: fee }],
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
