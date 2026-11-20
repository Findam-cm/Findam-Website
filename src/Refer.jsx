import { useEffect, useState } from 'react'
import { cities } from './data.js'
import { PriceInput } from './ui.jsx'
import { formatFcfa } from './price.js'

const EMPTY = {
  city: '', neighbourhood: '', type: 'Rent', detail: '', price: null, period: 'month',
  contactName: '', phone: '', landlordMode: 'contact', landlordName: '', landlordPhone: '',
}

export function authHeadersFor(member) {
  return member?.token ? { authorization: `Bearer ${member.token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }
}

function priceSuffix(type, period) {
  if (type === 'Sale') return 'sale price'
  if (type === 'Guest house') return 'per night'
  return period === 'year' ? 'per year' : 'per month'
}

export default function Refer({ member, onScore, go }) {
  const [account, setAccount] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))

  useEffect(() => {
    if (!member?.token) { setAccount(null); return }
    fetch('/api/credits', { headers: authHeadersFor(member) })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => { setAccount(payload); onScore?.(payload) })
      .catch(() => setAccount(null))
  }, [member?.token])

  const submit = async (event) => {
    event.preventDefault()
    if (!member?.token) { go('account'); return }
    setBusy(true)
    setMessage(null)
    const asking = form.price ? ` Asking ${formatFcfa(form.price)} ${priceSuffix(form.type, form.period)}.` : ''
    const body = {
      kind: 'property',
      contactName: form.contactName,
      phone: form.phone,
      city: form.city,
      neighbourhood: form.neighbourhood,
      detail: `${form.type}: ${form.detail.trim()}${asking}`.slice(0, 240),
    }
    if (form.landlordMode === 'contact') body.landlord = { sameAsContact: true }
    if (form.landlordMode === 'other') body.landlord = { contactName: form.landlordName, phone: form.landlordPhone }
    try {
      const response = await fetch('/api/referrals', { method: 'POST', headers: authHeadersFor(member), body: JSON.stringify(body) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The referral could not be saved.')
      setAccount(payload)
      onScore?.(payload)
      setForm(EMPTY)
      const both = Boolean(payload.landlordReferral)
      setMessage({
        tone: payload.landlordError ? 'warn' : 'ok',
        text: payload.landlordError
          ? `The property was sent for review. The landlord was not added: ${payload.landlordError}`
          : both ? 'Property and landlord sent for review. You will get up to 5 credits once an admin accepts them.' : 'Property sent for review. You will get 2 credits once an admin accepts it.',
      })
    } catch (error) {
      setMessage({ tone: 'warn', text: error.message || 'The referral could not be saved.' })
    } finally {
      setBusy(false)
    }
  }

  const score = account?.score ?? 0
  const freeAt = account?.freeAt ?? 5

  return <section className="shell section">
    <p className="kicker">REFERRAL CREDITS</p>
    <h1 className="page-title">Refer a property and earn credits</h1>
    <p className="lead">Tell us about a home that is available. Add its landlord too and you earn more. An admin checks every referral first, and credits are added once it is accepted. At {freeAt} credits, every property contact opens free.</p>

    <div className="refer-layout">
      <form className="refer-form" onSubmit={submit}>
        <fieldset>
          <legend><span className="step-no">1</span> The property</legend>
          <div className="field-grid">
            <label>City<select required value={form.city} onChange={(event) => set({ city: event.target.value })}><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select></label>
            <label>Neighbourhood<input required minLength="2" value={form.neighbourhood} onChange={(event) => set({ neighbourhood: event.target.value })} placeholder="e.g. Molyko" /></label>
            <label>Property type<select value={form.type} onChange={(event) => set({ type: event.target.value })}><option>Rent</option><option>Sale</option><option>Guest house</option></select></label>
            <label>Asking price (optional)
              <PriceInput value={form.price} onChange={(price) => set({ price })} placeholder={form.type === 'Sale' ? 'e.g. 25,000,000' : form.type === 'Guest house' ? 'e.g. 25,000' : 'e.g. 150,000'} />
              <small>Full amount in FCFA, {priceSuffix(form.type, form.period)}</small>
            </label>
            {form.type === 'Rent' ? <div className="segmented wide" role="group" aria-label="Rent is paid">
              <button type="button" className={form.period === 'month' ? 'selected' : ''} aria-pressed={form.period === 'month'} onClick={() => set({ period: 'month' })}>Rent per month</button>
              <button type="button" className={form.period === 'year' ? 'selected' : ''} aria-pressed={form.period === 'year'} onClick={() => set({ period: 'year' })}>Rent per year</button>
            </div> : null}
            <label className="span-2">What is available?<textarea required minLength="5" value={form.detail} onChange={(event) => set({ detail: event.target.value })} placeholder="e.g. Two bedrooms with a parlour, water and light, near the junction" /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend><span className="step-no">2</span> Who should we call about it?</legend>
          <div className="field-grid">
            <label>Contact name<input required minLength="2" value={form.contactName} onChange={(event) => set({ contactName: event.target.value })} /></label>
            <label>Phone<input required type="tel" inputMode="tel" value={form.phone} onChange={(event) => set({ phone: event.target.value })} placeholder="+237 6XX XXX XXX" /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend><span className="step-no">3</span> The landlord <em>(optional, +3 credits)</em></legend>
          <div className="radio-cards" role="radiogroup" aria-label="Landlord">
            {[['contact', 'The contact above is the landlord'], ['other', 'The landlord is someone else'], ['none', 'I do not know the landlord']].map(([value, text]) => <label key={value} className={form.landlordMode === value ? 'selected' : ''}>
              <input type="radio" name="landlordMode" value={value} checked={form.landlordMode === value} onChange={() => set({ landlordMode: value })} />{text}
            </label>)}
          </div>
          {form.landlordMode === 'other' ? <div className="field-grid">
            <label>Landlord name<input required minLength="2" value={form.landlordName} onChange={(event) => set({ landlordName: event.target.value })} /></label>
            <label>Landlord phone<input required type="tel" inputMode="tel" value={form.landlordPhone} onChange={(event) => set({ landlordPhone: event.target.value })} placeholder="+237 6XX XXX XXX" /></label>
          </div> : null}
        </fieldset>

        {message ? <p className={`form-message ${message.tone}`} role="status">{message.text}</p> : null}
        {member
          ? <button className="primary block" disabled={busy}>{busy ? 'Sending…' : 'Send for review'}</button>
          : <button type="button" className="primary block" onClick={() => go('account')}>Create an account or sign in to send</button>}
      </form>

      <aside className="refer-side">
        {member ? <div className={`credit-score ${account?.freeFinder ? 'free' : ''}`}>
          <strong>{score}</strong>
          <span>{account?.freeFinder ? 'You are a free finder. Every property contact opens free.' : `${Math.max(freeAt - score, 0)} more accepted credits until contacts are free.${account?.pendingCredits ? ` ${account.pendingCredits} waiting for review.` : ''}`}</span>
        </div> : <div className="credit-score"><span>Create a free account to send referrals and collect credits.</span></div>}
        <h3>How credits work</h3>
        <ul className="ticks">
          <li><b>+2</b> when an admin accepts the property</li>
          <li><b>+3</b> when an admin accepts its landlord</li>
          <li><b>1 credit</b> opens one property contact</li>
          <li><b>{freeAt} credits</b> and every contact opens free</li>
        </ul>
        {account?.referrals?.length ? <>
          <h3>Your referrals</h3>
          <ul className="referral-list">{account.referrals.map((item) => <li key={item.id}><span><b>{item.kind === 'landlord' ? 'Landlord' : 'Property'}</b> · {item.contact_name}, {item.neighbourhood}</span><span className={`status-pill ${item.status}`}>{item.status === 'accepted' ? `+${item.credits} accepted` : item.status === 'rejected' ? 'Declined' : 'In review'}</span></li>)}</ul>
        </> : null}
      </aside>
    </div>
  </section>
}
