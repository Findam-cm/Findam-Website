import { useEffect, useRef, useState } from 'react'
import { authHeadersFor } from './Refer.jsx'
import { formatFcfa } from './price.js'

const NETWORKS = [
  { id: 'MTN', name: 'MTN Mobile Money' },
  { id: 'ORANGE', name: 'Orange Money' },
]

export function timeLeft(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt || '') - now
  if (!(ms > 0)) return null
  const minutes = Math.ceil(ms / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

// Re-renders every 30 seconds so countdowns stay current, and tells the app when a pass runs out.
export function useClock(expiresAt, onExpire) {
  const [now, setNow] = useState(Date.now())
  const fired = useRef(false)
  useEffect(() => {
    fired.current = false
    if (!expiresAt) return undefined
    const tick = () => {
      const current = Date.now()
      setNow(current)
      if (!fired.current && Date.parse(expiresAt) <= current) { fired.current = true; onExpire?.() }
    }
    const timer = window.setInterval(tick, 30000)
    const ms = Date.parse(expiresAt) - Date.now()
    const exact = ms > 0 && ms < 2 ** 31 ? window.setTimeout(tick, ms + 500) : null
    return () => { window.clearInterval(timer); if (exact) window.clearTimeout(exact) }
  }, [expiresAt])
  return now
}

export function PassModal({ member, settings, onClose, onActive }) {
  const [service, setService] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(Boolean(settings?.pending))
  const [waited, setWaited] = useState(0)

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  // While waiting for approval on the phone, ask the server every 5 seconds.
  useEffect(() => {
    if (!waiting) return undefined
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/pass', { headers: authHeadersFor(member) })
        const data = await response.json()
        if (data.active) { onActive(data); return }
        if (!data.pending) {
          setWaiting(false)
          setError(data.lastFailed?.error ? `The payment did not go through: ${data.lastFailed.error}` : 'The payment did not go through. You can try again.')
          return
        }
      } catch {}
      setWaited((n) => n + 5)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [waiting, waited])

  const pay = async (event) => {
    event.preventDefault()
    if (!service) { setError('Choose MTN Mobile Money or Orange Money.'); return }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/pass', { method: 'POST', headers: authHeadersFor(member), body: JSON.stringify({ service, phone }) })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.pass?.status === 'pending') { setWaiting(true); return }
      if (!response.ok) throw new Error(data.error || 'The payment could not be started.')
      if (data.pass?.status === 'active') { onActive({ ...settings, active: data.active || null }); return }
      if (data.pass?.status === 'failed') throw new Error(`The payment did not go through: ${data.pass.error || 'it was not approved.'}`)
      setWaited(0)
      setWaiting(true)
    } catch (payError) {
      setError(payError.message)
    } finally {
      setBusy(false)
    }
  }

  const hours = settings?.hours || 48
  const homes = settings?.homes || 4
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose() }}>
    <div className="modal pass-modal" role="dialog" aria-modal="true" aria-labelledby="pass-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="modal-x" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
      <div className="modal-icon lock" aria-hidden="true">🔓</div>
      <h2 id="pass-title">Unlock {homes} homes for {hours} hours</h2>
      <p>Choose up to <b>{homes} homes</b> you like best and see each landlord’s phone number and the exact location of the house. After {hours} hours, all of them lock again.</p>
      <p className="pass-price">{formatFcfa(settings?.fee || 0)} <span>{homes} homes · {hours} hours</span></p>
      {!settings?.configured ? <p className="form-message warn">Mobile Money payments are being switched on. Please try again a little later.</p> : waiting ? <div className="pay-wait compact" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div><b>Approve the payment on your phone</b><p>Enter your Mobile Money PIN to confirm {formatFcfa(settings?.fee || 0)}. This window updates by itself.</p>
          {waited >= 45 ? <p className="muted">No prompt? Open your Mobile Money menu (MTN: *126#, Orange: #150#) and approve the pending payment.</p> : null}</div>
      </div> : <form className="pay-form" onSubmit={pay}>
        <fieldset className="pay-networks">
          <legend>Pay with</legend>
          {NETWORKS.map((item) => <label key={item.id} className={`network ${item.id.toLowerCase()}${service === item.id ? ' selected' : ''}`}>
            <input type="radio" name="pass-network" value={item.id} checked={service === item.id} onChange={() => setService(item.id)} />
            <span className="network-dot" aria-hidden="true" />{item.name}
          </label>)}
        </fieldset>
        <label className="pay-phone">Mobile Money number
          <input type="tel" inputMode="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6XX XXX XXX" autoFocus />
        </label>
        {error ? <p className="form-message warn" role="alert">{error}</p> : null}
        <button className="primary block" disabled={busy}>{busy ? 'Sending the request to your phone…' : `Pay ${formatFcfa(settings?.fee || 0)}`}</button>
        <p className="pay-secure">Payments are processed by MeSomb. Findam never sees your PIN. After paying, open a home and press “Unlock this home”.</p>
      </form>}
      {error && waiting ? <p className="form-message warn" role="alert">{error}</p> : null}
    </div>
  </div>
}
