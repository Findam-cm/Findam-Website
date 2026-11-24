import { useEffect, useState } from 'react'
import { cities } from './data.js'
import { REFERRAL_PROGRAMME as P } from './referral.js'
import { formatFcfa } from './price.js'

const EMPTY = { contactName: '', phone: '', city: '', neighbourhood: '', detail: '', referrerPhone: '' }

export function authHeadersFor(member) {
  return member?.token ? { authorization: `Bearer ${member.token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }
}

const STATUS = { pending: ['In review', 'pending'], accepted: ['Accepted', 'accepted'], rejected: ['Not accepted', 'rejected'] }
const REWARD_STATUS = {
  requested: 'waiting for the landlord to pay',
  collecting: 'landlord is paying',
  collect_failed: 'waiting for the landlord to pay',
  paid: 'paid by the landlord, on its way to you',
  paying_out: 'on its way to you',
  payout_failed: 'paid by the landlord, Findam will send it to you shortly',
  completed: 'sent to your Mobile Money ✓',
}

export default function Refer({ member, go }) {
  const [referrals, setReferrals] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))

  useEffect(() => {
    if (!member?.token) { setReferrals(null); return }
    fetch('/api/account', { headers: authHeadersFor(member) })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setReferrals((payload.referrals || []).filter((item) => item.kind === 'landlord')))
      .catch(() => setReferrals([]))
  }, [member?.token])

  const submit = async (event) => {
    event.preventDefault()
    if (!member?.token) { go('account'); return }
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/referrals', { method: 'POST', headers: authHeadersFor(member), body: JSON.stringify(form) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The referral could not be sent.')
      setReferrals((payload.referrals || []).filter((item) => item.kind === 'landlord'))
      setForm((current) => ({ ...EMPTY, referrerPhone: current.referrerPhone }))
      setMessage({ tone: 'ok', text: 'Thank you. We will contact the landlord. After we visit and confirm one of their homes, the landlord pays your reward and it is sent to your Mobile Money number.' })
    } catch (error) {
      setMessage({ tone: 'warn', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  return <section className="shell section">
    <p className="kicker">{P.name.toUpperCase()}</p>
    <h1 className="page-title">Refer a landlord to Findam</h1>
    <p className="lead refer-lead">{P.promise}</p>
    {P.reward ? <p className="reward-line">{P.reward}</p> : null}

    <ol className="programme-steps" aria-label="How the referral programme works">
      {P.steps.map(([title, text], index) => <li key={title}><span className="step-no">{index + 1}</span><div><b>{title}</b><p>{text}</p></div></li>)}
    </ol>

    <div className="refer-layout">
      <form className="refer-form" onSubmit={submit}>
        <fieldset>
          <legend>The landlord</legend>
          <div className="field-grid">
            <label>Landlord’s name<input required minLength="2" value={form.contactName} onChange={(event) => set({ contactName: event.target.value })} placeholder="e.g. Mr. Ndi" /></label>
            <label>Landlord’s phone<input required type="tel" inputMode="tel" value={form.phone} onChange={(event) => set({ phone: event.target.value })} placeholder="+237 6XX XXX XXX" /></label>
            <label>City<select required value={form.city} onChange={(event) => set({ city: event.target.value })}><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select></label>
            <label>Neighbourhood<input required minLength="2" value={form.neighbourhood} onChange={(event) => set({ neighbourhood: event.target.value })} placeholder="e.g. Molyko" /></label>
            <label className="span-2">What homes do they have? (optional)<textarea value={form.detail} onChange={(event) => set({ detail: event.target.value })} placeholder="e.g. Six self-contained rooms and a two-bedroom apartment near the junction" /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>You</legend>
          <div className="field-grid">
            <label className="span-2">Your Mobile Money number (MTN or Orange)<input required type="tel" inputMode="tel" value={form.referrerPhone} onChange={(event) => set({ referrerPhone: event.target.value })} placeholder="6XX XXX XXX" /><small>Your reward is sent to this number. It is never shown to the landlord or on the site.</small></label>
          </div>
        </fieldset>
        {message ? <p className={`form-message ${message.tone}`} role="status">{message.text}</p> : null}
        {member
          ? <button className="primary block" disabled={busy}>{busy ? 'Sending…' : 'Refer this landlord'}</button>
          : <button type="button" className="primary block" onClick={() => go('account')}>Create an account or sign in to refer</button>}
      </form>

      <aside className="refer-side">
        <h3>Programme rules</h3>
        <ul className="ticks">{P.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        {P.termsUrl ? <a className="secondary terms-link" href={P.termsUrl} target="_blank" rel="noreferrer">Read the full programme terms</a> : null}
        {member ? <>
          <h3>Landlords you referred</h3>
          {referrals === null ? <p className="muted">Loading…</p> : referrals.length ? <ul className="referral-list">{referrals.map((item) => {
            const [label, tone] = STATUS[item.status] || STATUS.pending
            const rewards = Array.isArray(item.rewards) ? item.rewards : []
            return <li key={item.id} className="referral-item">
              <span><b>{item.contact_name}</b> · {item.neighbourhood}, {item.city}</span>
              <span className={`status-pill ${tone}`}>{label}</span>
              {rewards.map((reward, index) => <small key={index} className="reward-line-item">{reward.listing}: {formatFcfa(reward.amount)} · {REWARD_STATUS[reward.status] || 'In progress'}</small>)}
            </li>
          })}</ul> : <p className="muted">No referrals yet. Your first one will appear here.</p>}
        </> : null}
      </aside>
    </div>
  </section>
}
