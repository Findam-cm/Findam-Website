import { useEffect, useRef, useState } from 'react'
import { formatFcfa } from './price.js'

const NETWORKS = [
  { id: 'MTN', name: 'MTN Mobile Money', menu: '*126#' },
  { id: 'ORANGE', name: 'Orange Money', menu: '#150#' },
]

function tokenFromPath() {
  return (window.location.pathname.match(/^\/pay\/([0-9a-f]{48})/) || [])[1] || ''
}

// Page a landlord opens from the link Findam sends them, to pay a referral reward with Mobile Money.
export default function PayReward({ navigate }) {
  const token = tokenFromPath()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [service, setService] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [waited, setWaited] = useState(0)
  const timer = useRef(null)

  const load = async () => {
    try {
      const response = await fetch(`/api/pay/${token}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'This payment link could not be opened.')
      setInfo(payload)
      setError('')
      return payload
    } catch (loadError) {
      setError(loadError.message)
      return null
    }
  }

  useEffect(() => {
    load().then((payload) => {
      if (!payload) return
      setPhone(payload.landlordPhone || '')
      setService(payload.suggestedService || '')
    })
    return () => window.clearTimeout(timer.current)
  }, [token])

  // While the landlord approves on their phone, check every 5 seconds.
  useEffect(() => {
    if (info?.stage !== 'processing') return undefined
    timer.current = window.setTimeout(async () => { await load(); setWaited((n) => n + 5) }, 5000)
    return () => window.clearTimeout(timer.current)
  }, [info, waited])

  const pay = async (event) => {
    event.preventDefault()
    if (!service) { setError('Choose MTN Mobile Money or Orange Money.'); return }
    setBusy(true)
    setError('')
    setWaited(0)
    try {
      const response = await fetch(`/api/pay/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service, phone }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The payment could not be started.')
      setInfo(payload)
    } catch (payError) {
      setError(payError.message)
    } finally {
      setBusy(false)
    }
  }

  const network = NETWORKS.find((item) => item.id === service)

  return <section className="shell section narrow pay-page">
    <p className="kicker">FINDAM REFERRAL PROGRAMME</p>
    <h1 className="page-title">Referral reward payment</h1>
    {!info && !error ? <p className="muted" role="status">Loading…</p> : null}
    {!info && error ? <div className="admin-setup" role="alert"><h2>Link not valid</h2><p>{error}</p><button className="secondary" onClick={() => navigate('/')}>Go to Findam</button></div> : null}
    {info ? <>
      <div className="pay-card">
        <span className="pay-label">Amount to pay</span>
        <strong className="pay-amount">{formatFcfa(info.amount)}</strong>
        <span className="pay-for">For your home: <b>{info.listingTitle}</b></span>
        <p>Findam has visited and confirmed your home. Under the Findam Referral Programme, the person who introduced you to Findam receives this reward from you. Findam passes it on to them as soon as you pay.</p>
      </div>

      {info.stage === 'paid' ? <div className="pay-done" role="status"><div className="modal-icon" aria-hidden="true">✓</div><h2>Thank you, the reward is paid</h2><p>Your payment was received{info.paidAt ? ` on ${new Date(info.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. Nothing more is needed.</p></div> : null}

      {info.stage === 'cancelled' ? <div className="admin-setup" role="status"><h2>This request was cancelled</h2><p>There is nothing to pay. Contact Findam if you think this is a mistake.</p></div> : null}

      {info.stage === 'processing' ? <div className="pay-wait" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div>
          <h2>Approve the payment on your phone</h2>
          <p>A Mobile Money request for {formatFcfa(info.amount)} has been sent to your phone. Enter your PIN to approve it.</p>
          {waited >= 45 ? <p className="muted">No prompt yet? Open your Mobile Money menu (MTN: *126#, Orange: #150#) and approve the pending payment there. This page updates by itself.</p> : null}
        </div>
      </div> : null}

      {info.stage === 'due' ? <form className="pay-form" onSubmit={pay}>
        {!info.configured ? <p className="form-message warn" role="status">Mobile Money payments are being switched on. Please come back to this link a little later.</p> : null}
        {info.lastError ? <p className="form-message warn" role="alert">The last attempt did not go through: {info.lastError} You can try again.</p> : null}
        <fieldset className="pay-networks">
          <legend>Pay with</legend>
          {NETWORKS.map((item) => <label key={item.id} className={`network ${item.id.toLowerCase()}${service === item.id ? ' selected' : ''}`}>
            <input type="radio" name="network" value={item.id} checked={service === item.id} onChange={() => setService(item.id)} />
            <span className="network-dot" aria-hidden="true" />{item.name}
          </label>)}
        </fieldset>
        <label className="pay-phone">Mobile Money number
          <input type="tel" inputMode="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6XX XXX XXX" />
          <small>The number that will approve the payment.</small>
        </label>
        {error ? <p className="form-message warn" role="alert">{error}</p> : null}
        <button className="primary block" disabled={busy || !info.configured}>{busy ? 'Sending the request to your phone…' : `Pay ${formatFcfa(info.amount)}${network ? ` with ${network.name}` : ''}`}</button>
        <p className="pay-secure">Payments are processed by MeSomb. Findam never sees your PIN.</p>
      </form> : null}
    </> : null}
  </section>
}
