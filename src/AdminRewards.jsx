import { useEffect, useState } from 'react'
import { authHeadersFor } from './Refer.jsx'
import { formatFcfa, groupDigits, toAmount } from './price.js'

const STATUS_LABEL = {
  requested: ['Waiting for the landlord to pay', 'pending'],
  collecting: ['Landlord is approving on their phone', 'pending'],
  collect_failed: ['Landlord payment failed', 'rejected'],
  paid: ['Paid by landlord, sending to referrer', 'pending'],
  paying_out: ['Sending to referrer', 'pending'],
  payout_failed: ['Paid by landlord, payout to referrer failed', 'rejected'],
  completed: ['Completed: referrer received the reward', 'accepted'],
  cancelled: ['Cancelled', 'rejected'],
}

function whatsappLink(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 9) digits = `237${digits}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

async function call(member, url, options = {}) {
  const response = await fetch(url, { ...options, headers: authHeadersFor(member) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'The request failed.')
  return payload
}

function NetworkPicker({ value, onChange }) {
  return <select className="mini-select" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Mobile Money network">
    <option value="">Network…</option><option value="MTN">MTN</option><option value="ORANGE">Orange</option>
  </select>
}

function PayLinkTools({ reward }) {
  const [copied, setCopied] = useState(false)
  const text = `Hello, Findam has visited and confirmed your home "${reward.listing_title}". As agreed in the Findam Referral Programme, please pay the referral reward of ${formatFcfa(reward.amount)} here: ${reward.payLink}`
  return <div className="paylink">
    <input readOnly value={reward.payLink} aria-label="Payment link" onFocus={(event) => event.target.select()} />
    <button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(reward.payLink); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {} }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
    <a className="secondary" href={whatsappLink(reward.landlord_phone, text)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
  </div>
}

export function PaymentsPanel({ member, refreshKey }) {
  const [state, setState] = useState(null)
  useEffect(() => { call(member, '/api/admin/payments').then(setState).catch((error) => setState({ error: error.message })) }, [member?.token, refreshKey])
  if (!state) return null
  if (state.error) return <p className="admin-error">{state.error}</p>
  if (!state.configured) return <div className="admin-setup mesomb-setup">
    <h2>Connect MeSomb to take referral payments</h2>
    <p>Landlords pay referral rewards with MTN Mobile Money or Orange Money through MeSomb, and Findam sends the reward to the referrer. To switch it on, add your three MeSomb keys as Worker secrets (the exact commands are in the setup notes). Until then you can still confirm visits and create payment links; landlords will see that payments are being switched on.</p>
  </div>
  return <div className="admin-message mesomb-ok">MeSomb is connected.{state.balance !== null ? ` Account balance: ${formatFcfa(state.balance)}.` : ''}{state.problem ? ` Note: ${state.problem}` : ''}</div>
}

// "Confirm visit" control under each listing in the admin dashboard.
export function VisitConfirm({ item, member, onDone, onError }) {
  const [open, setOpen] = useState(false)
  const [match, setMatch] = useState(null)
  const [amount, setAmount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)

  const load = async () => {
    try {
      const data = await call(member, `/api/admin/listings/${encodeURIComponent(item.id)}/reward-match`)
      setMatch(data)
      if (data.defaultAmount && amount === null) setAmount(data.defaultAmount)
    } catch (error) { onError(error.message) }
  }
  useEffect(() => { if (open) load() }, [open])

  const confirm = async (withReward) => {
    setBusy(true)
    onError('')
    try {
      const data = await call(member, `/api/admin/listings/${encodeURIComponent(item.id)}/visit`, {
        method: 'POST',
        body: JSON.stringify(withReward ? { referralId: match.referral.id, amount } : {}),
      })
      setCreated(data.reward)
      await load()
      onDone(withReward ? 'Visit confirmed and reward payment link created.' : 'Visit confirmed.')
    } catch (error) { onError(error.message) } finally { setBusy(false) }
  }

  const open_ = match?.rewards?.filter((reward) => reward.status !== 'cancelled') || []
  return <div className="visit-confirm">
    <button type="button" className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Close' : item.visitConfirmedAt ? 'Visit confirmed ✓ · referral reward' : 'Confirm visit'}</button>
    {open ? <div className="pin-panel">
      {!match ? <p className="muted">Checking for a referral…</p> : <>
        {match.listing.visitConfirmedAt ? <p className="muted">Visit confirmed on {new Date(match.listing.visitConfirmedAt).toLocaleDateString('en-GB')}.</p> : null}
        {match.referral ? <p><b>Referred landlord:</b> {match.referral.landlord}. Referred by {match.referral.referrerEmail}{match.referral.referrerPhone ? ` (${match.referral.referrerPhone})` : ''}.</p>
          : <p className="muted">No accepted landlord referral matches this listing’s phone number{match.listing.phone ? ` (${match.listing.phone})` : ''}, so there is no reward to request.</p>}
        {open_.map((reward) => <div key={reward.id} className="reward-mini"><span className={`status-pill ${STATUS_LABEL[reward.status]?.[1] || ''}`}>{STATUS_LABEL[reward.status]?.[0] || reward.status}</span> {formatFcfa(reward.amount)}{['requested', 'collect_failed'].includes(reward.status) ? <PayLinkTools reward={reward} /> : null}</div>)}
        {match.referral && !open_.length ? <div className="reward-create">
          <label>Reward the landlord pays (FCFA)
            <input type="text" inputMode="numeric" value={amount ? groupDigits(String(amount)) : ''} onChange={(event) => setAmount(toAmount(event.target.value))} placeholder="e.g. 10,000" />
          </label>
          <button type="button" className="primary" disabled={busy || !amount} onClick={() => confirm(true)}>{busy ? 'Saving…' : 'Confirm visit and request reward'}</button>
        </div> : null}
        {!match.listing.visitConfirmedAt && !(match.referral && !open_.length) ? <button type="button" className="secondary" disabled={busy} onClick={() => confirm(false)}>Confirm visit</button> : null}
        {created ? <p className="admin-message">Send the payment link to the landlord. Findam sends the reward to the referrer automatically after the landlord pays.</p> : null}
      </>}
    </div> : null}
  </div>
}

export function RewardsList({ member, refreshKey, onMessage, onError }) {
  const [rewards, setRewards] = useState(null)
  const [busy, setBusy] = useState('')
  const [networks, setNetworks] = useState({})
  const load = () => call(member, '/api/admin/rewards').then((data) => setRewards(data.rewards)).catch((error) => onError(error.message))
  useEffect(() => { load() }, [member?.token, refreshKey])

  const act = async (reward, action) => {
    setBusy(reward.id)
    onError('')
    try {
      const data = await call(member, `/api/admin/rewards/${reward.id}/${action}`, { method: 'POST', body: JSON.stringify({ service: networks[reward.id] || '' }) })
      const status = data.reward?.status
      onMessage(action === 'cancel' ? 'Reward request cancelled.' : status === 'completed' ? 'The referrer has received the reward.' : status === 'paying_out' || status === 'collecting' ? 'Sent to MeSomb. The status updates when you refresh.' : 'Done.')
      await load()
    } catch (error) { onError(error.message) } finally { setBusy('') }
  }

  if (!rewards) return <p className="muted">Loading referral rewards…</p>
  if (!rewards.length) return <p>No referral rewards yet. Confirm a visit on a listing whose landlord was referred to create one.</p>
  return rewards.map((reward) => {
    const [label, tone] = STATUS_LABEL[reward.status] || [reward.status, '']
    return <article key={reward.id}>
      <div>
        <b>{formatFcfa(reward.amount)} · {reward.listing_title}</b>
        <p>Landlord pays from {reward.payer_phone || reward.landlord_phone}{reward.collect_service ? ` (${reward.collect_service})` : ''} · Referrer {reward.referrer_email} receives on {reward.referrer_phone}{reward.payout_service ? ` (${reward.payout_service})` : ''}</p>
        <span className={`status-pill ${tone}`}>{label}</span>
        {reward.last_error ? <p className="form-message warn">{reward.last_error}</p> : null}
        {['requested', 'collect_failed'].includes(reward.status) ? <PayLinkTools reward={reward} /> : null}
      </div>
      <div className="admin-actions column">
        {['requested', 'collect_failed'].includes(reward.status) ? <>
          <NetworkPicker value={networks[reward.id] || ''} onChange={(value) => setNetworks({ ...networks, [reward.id]: value })} />
          <button type="button" className="primary" disabled={busy === reward.id || !networks[reward.id]} onClick={() => act(reward, 'prompt')}>Send payment prompt to landlord</button>
          <button type="button" className="secondary" disabled={busy === reward.id} onClick={() => act(reward, 'cancel')}>Cancel</button>
        </> : null}
        {['paid', 'payout_failed'].includes(reward.status) ? <>
          <NetworkPicker value={networks[reward.id] || ''} onChange={(value) => setNetworks({ ...networks, [reward.id]: value })} />
          <button type="button" className="primary" disabled={busy === reward.id} onClick={() => act(reward, 'payout')}>Send reward to referrer</button>
        </> : null}
        {['collecting', 'paying_out'].includes(reward.status) ? <button type="button" className="secondary" onClick={load}>Check status</button> : null}
      </div>
    </article>
  })
}
