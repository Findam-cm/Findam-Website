// Referral rewards: after Findam confirms a visit to a landlord's home, the landlord pays the reward
// through MeSomb (Mobile Money collect), and Findam sends it on to the member who referred them (deposit).
//
// Status flow:
//   requested -> collecting -> paid -> paying_out -> completed
//   collecting -> collect_failed (landlord can try again)      paying_out -> payout_failed (admin can retry)
//   requested | collect_failed -> cancelled
import { checkTransactions, collect, deposit, guessOperator, localNumber, transactionStatus } from './mesomb.js'
import { getReward, transitionReward } from './db.js'

const SERVICES = new Set(['MTN', 'ORANGE'])
const shortId = (id) => String(id).replace(/-/g, '').slice(0, 16)
const clip = (text) => String(text || '').slice(0, 300)

// What the landlord sees on the payment page. Nothing about the referrer is exposed.
export function landlordView(reward, configured) {
  const stage = ['paid', 'paying_out', 'payout_failed', 'completed'].includes(reward.status) ? 'paid'
    : reward.status === 'collecting' ? 'processing'
      : reward.status === 'cancelled' ? 'cancelled' : 'due'
  return {
    stage,
    amount: reward.amount,
    listingTitle: reward.listing_title,
    landlordPhone: reward.landlord_phone,
    suggestedService: guessOperator(reward.payer_phone || reward.landlord_phone),
    lastError: stage === 'due' ? reward.last_error : null,
    paidAt: reward.paid_at,
    configured,
  }
}

async function failCollect(db, reward, message) {
  return (await transitionReward(db, reward.id, ['collecting'], 'collect_failed', { last_error: clip(message || 'The payment was not approved.') })) || reward
}

export async function startCollect(env, db, reward, { service, phone }) {
  const payer = localNumber(phone)
  if (!payer) return { error: 'Enter a Cameroon Mobile Money number, for example 677 12 34 56.', status: 400 }
  if (!SERVICES.has(service)) return { error: 'Choose MTN Mobile Money or Orange Money.', status: 400 }
  const attempt = Number(reward.collect_attempts || 0) + 1
  const trx = `${shortId(reward.id)}c${attempt}`
  const locked = await transitionReward(db, reward.id, ['requested', 'collect_failed'], 'collecting', {
    collect_attempts: attempt, collect_trx: trx, collect_service: service, payer_phone: payer, last_error: null,
  })
  if (!locked) return { error: 'This payment is already being processed or has been paid.', status: 409 }
  const result = await collect(env, {
    amount: reward.amount,
    service,
    payer,
    trxID: trx,
    products: [{ name: `Findam referral reward - ${reward.listing_title}`.slice(0, 100), category: 'Referral reward', quantity: 1, amount: reward.amount }],
  })
  return { reward: await settleCollect(env, db, locked, result) }
}

async function settleCollect(env, db, reward, result) {
  if (!result.ok) {
    // A clear refusal from MeSomb fails the attempt; a timeout leaves it "collecting" to be checked again.
    if (result.status >= 400 && result.status < 500) return failCollect(db, reward, result.error)
    return (await transitionReward(db, reward.id, ['collecting'], 'collecting', { last_error: clip(result.error) })) || reward
  }
  const status = transactionStatus(result.data)
  if (status === 'SUCCESS') return markPaidAndPayout(env, db, reward)
  if (status === 'FAILED') return failCollect(db, reward, result.data?.message || result.data?.transaction?.message)
  return reward
}

async function markPaidAndPayout(env, db, reward) {
  const paid = await transitionReward(db, reward.id, ['collecting'], 'paid', { paid_at: new Date().toISOString() })
  if (!paid) return (await getReward(db, { id: reward.id })) || reward
  return (await startPayout(env, db, paid)).reward
}

export async function startPayout(env, db, reward, serviceOverride) {
  const receiver = localNumber(reward.referrer_phone)
  const service = SERVICES.has(serviceOverride) ? serviceOverride : reward.payout_service || guessOperator(receiver)
  if (!receiver || !service) {
    const parked = await transitionReward(db, reward.id, ['paid', 'payout_failed'], 'payout_failed', {
      last_error: !receiver ? 'The referrer’s phone number is not a valid Cameroon Mobile Money number.' : 'Choose the referrer’s network (MTN or Orange) to send the reward.',
    })
    return { reward: parked || reward }
  }
  const attempt = Number(reward.payout_attempts || 0) + 1
  const trx = `${shortId(reward.id)}p${attempt}`
  const locked = await transitionReward(db, reward.id, ['paid', 'payout_failed'], 'paying_out', {
    payout_attempts: attempt, payout_trx: trx, payout_service: service, last_error: null,
  })
  if (!locked) return { error: 'The reward is already being sent or has been sent.', status: 409, reward: await getReward(db, { id: reward.id }) }
  const result = await deposit(env, { amount: reward.amount, service, receiver, trxID: trx })
  return { reward: await settlePayout(db, locked, result) }
}

async function settlePayout(db, reward, result) {
  if (!result.ok) {
    if (result.status >= 400 && result.status < 500) {
      return (await transitionReward(db, reward.id, ['paying_out'], 'payout_failed', { last_error: clip(result.error) })) || reward
    }
    return (await transitionReward(db, reward.id, ['paying_out'], 'paying_out', { last_error: clip(result.error) })) || reward
  }
  const status = transactionStatus(result.data)
  if (status === 'SUCCESS') return (await transitionReward(db, reward.id, ['paying_out'], 'completed', { completed_at: new Date().toISOString() })) || reward
  if (status === 'FAILED') return (await transitionReward(db, reward.id, ['paying_out'], 'payout_failed', { last_error: clip(result.data?.message || 'MeSomb could not send the reward.') })) || reward
  return reward
}

// Asks MeSomb about a step that is still in progress (the landlord approving, or the payout).
export async function refreshReward(env, db, reward) {
  const inFlight = reward.status === 'collecting' ? reward.collect_trx : reward.status === 'paying_out' ? reward.payout_trx : null
  if (!inFlight) return reward
  const result = await checkTransactions(env, [inFlight])
  if (!result.ok) return reward
  const list = Array.isArray(result.data) ? result.data : result.data?.results || []
  const found = list.find((item) => [item.trxID, item.external_id, item.reference].includes(inFlight)) || (list.length === 1 ? list[0] : null)
  if (!found) return reward
  const status = transactionStatus(found)
  if (reward.status === 'collecting') {
    if (status === 'SUCCESS') return markPaidAndPayout(env, db, reward)
    if (status === 'FAILED') return failCollect(db, reward, found.message)
  } else {
    if (status === 'SUCCESS') return (await transitionReward(db, reward.id, ['paying_out'], 'completed', { completed_at: new Date().toISOString() })) || reward
    if (status === 'FAILED') return (await transitionReward(db, reward.id, ['paying_out'], 'payout_failed', { last_error: clip(found.message || 'MeSomb could not send the reward.') })) || reward
  }
  return reward
}
