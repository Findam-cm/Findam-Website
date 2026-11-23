import { Suspense, lazy, useEffect, useState } from 'react'
import { authHeadersFor } from './Refer.jsx'
import { priceLine } from './price.js'

const LocationPicker = lazy(() => import('./LocationPicker.jsx'))

// Lets the admin pin a listing's exact house. Visitors only ever see the pin.
function PinEditor({ item, member, onSaved, onError }) {
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState(item.exact ? { lat: item.lat, lng: item.lng } : null)
  const [saving, setSaving] = useState(false)
  const save = async (clear) => {
    setSaving(true)
    onError('')
    try {
      const response = await fetch(`/api/admin/listings/${encodeURIComponent(item.id)}/location`, {
        method: 'POST',
        headers: authHeadersFor(member),
        body: JSON.stringify(clear ? { clear: true } : point),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The location could not be saved.')
      setOpen(false)
      await onSaved(clear ? `Exact pin removed from "${item.title}".` : `Exact location saved for "${item.title}".`)
    } catch (saveError) {
      onError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="pin-editor">
    <span className={`status-pill ${item.exact ? 'live' : 'pending'}`}>{item.exact ? 'Exact pin set' : 'Neighbourhood only'}</span>
    <button type="button" className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Close map' : item.exact ? 'Move pin' : 'Set exact location'}</button>
    {open ? <div className="pin-panel">
      <Suspense fallback={<p className="muted">Loading the map…</p>}><LocationPicker value={point} onChange={setPoint} city={item.city} /></Suspense>
      <div className="pin-actions">
        <button type="button" className="primary" disabled={!point || saving} onClick={() => save(false)}>{saving ? 'Saving…' : 'Save location'}</button>
        {item.exact ? <button type="button" className="secondary" disabled={saving} onClick={() => save(true)}>Use neighbourhood only</button> : null}
      </div>
    </div> : null}
  </div>
}

export default function Admin({ member, authReady, access, onPublished }) {
  const [referrals, setReferrals] = useState([])
  const [listings, setListings] = useState([])
  const [published, setPublished] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const headers = authHeadersFor(member)
      const [referralResponse, listingResponse, publicResponse] = await Promise.all([
        fetch('/api/admin/referrals', { headers }),
        fetch('/api/admin/listings', { headers }),
        fetch('/api/listings'),
      ])
      const [referralPayload, listingPayload, publicPayload] = await Promise.all([
        referralResponse.json(),
        listingResponse.json(),
        publicResponse.json().catch(() => ({})),
      ])
      if (!referralResponse.ok) throw new Error(referralPayload.error || 'Could not load referral reviews.')
      if (!listingResponse.ok) throw new Error(listingPayload.error || 'Could not load listing reviews.')
      setReferrals(referralPayload.referrals || [])
      setListings(listingPayload.listings || [])
      setPublished(publicPayload.listings || [])
    } catch (loadError) {
      setError(loadError.message || 'The admin dashboard could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (access === 'admin') load()
  }, [member?.token, access])

  const setAvailable = async (item) => {
    setBusy(String(item.id))
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(item.id)}/availability`, {
        method: 'POST',
        headers: authHeadersFor(member),
        body: JSON.stringify({ available: item.available === false }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The listing could not be updated.')
      setMessage(payload.available ? `"${item.title}" is available again.` : `"${item.title}" is marked as taken and hidden from search.`)
      await load()
      await onPublished?.()
    } catch (updateError) {
      setError(updateError.message || 'The listing could not be updated.')
    } finally {
      setBusy('')
    }
  }

  const review = async (kind, id, decision) => {
    const endpoint = kind === 'listing' ? 'listings' : 'referrals'
    setBusy(id)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/admin/${endpoint}/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: authHeadersFor(member),
        body: JSON.stringify({ decision }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The review could not be saved.')
      setMessage(kind === 'listing'
        ? decision === 'accepted' ? 'Listing accepted and published.' : 'Listing declined and kept off the public site.'
        : decision === 'accepted' ? 'Referral accepted and credits added.' : 'Referral declined; no credits were added.')
      await load()
      if (kind === 'listing' && decision === 'accepted') {
        try {
          await onPublished?.()
        } catch (refreshError) {
          setError(`The listing was published, but the public listings could not be refreshed: ${refreshError.message}`)
        }
      }
    } catch (reviewError) {
      setError(reviewError.message || 'The review could not be saved.')
    } finally {
      setBusy('')
    }
  }

  return <section className="shell section">
    <p className="kicker">ADMINISTRATION</p>
    <h1 className="page-title">Admin dashboard</h1>
    <p className="lead">This area is for the Findam team.</p>
    {!authReady || access === 'checking' ? <p role="status">Checking your access…</p> : !member ? (
      <div className="admin-setup">
        <h2>Sign in to continue</h2>
        <p>Sign in with the Findam administrator account to review listings and referrals.</p>
        <button className="primary" onClick={() => { window.location.href = '/account?mode=signin' }}>Sign in</button>
      </div>
    ) : access === 'unavailable' ? (
      <div className="admin-setup" role="alert">
        <h2>We could not check your access</h2>
        <p>Please reload the page in a moment.</p>
      </div>
    ) : access !== 'admin' ? (
      <div className="admin-setup" role="status">
        <h2>This page is for administrators</h2>
        <p>You are signed in as {member.email}, which does not have administrator access.</p>
        <button className="secondary" onClick={() => { window.location.href = '/homes' }}>Browse homes</button>
      </div>
    ) : (
      <>
        <div className="admin-toolbar">
          <p>Signed in as <b>{member.email}</b></p>
          <button className="secondary" type="button" disabled={loading} onClick={load}>{loading ? 'Refreshing…' : 'Refresh queues'}</button>
        </div>
        {message ? <p className="admin-message" role="status">{message}</p> : null}
        {error ? <p className="admin-error" role="alert">{error}</p> : null}
        <div className="admin-queue">
          <h2>Listings waiting for review <span>{listings.length}</span></h2>
          {loading && !listings.length ? <p>Loading listings…</p> : listings.length ? listings.map((item) => <article key={item.id}>
            <div>
              <b>{item.title}</b>
              <p>{item.neighbourhood}, {item.city} · {item.type} · {priceLine(item)}{item.beds ? ` · ${item.beds} beds` : ''}</p>
              <p>{item.phone}</p>
              <small>Submitted by {item.submittedEmail || 'unknown account'}</small>
              {item.description ? <p>{item.description}</p> : null}
              {item.photos?.length ? <div className="admin-photos">{item.photos.map((src) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" loading="lazy" /></a>)}</div> : null}
              <PinEditor item={item} member={member} onSaved={async (text) => { setMessage(text); await load(); await onPublished?.() }} onError={setError} />
            </div>
            <div className="admin-actions">
              <button className="primary" type="button" disabled={busy === item.id} onClick={() => review('listing', item.id, 'accepted')}>Accept</button>
              <button className="secondary" type="button" disabled={busy === item.id} onClick={() => review('listing', item.id, 'rejected')}>Decline</button>
            </div>
          </article>) : <p>No property listings are waiting for review.</p>}

          <h2>Referrals waiting for review <span>{referrals.length}</span></h2>
          {loading && !referrals.length ? <p>Loading referrals…</p> : referrals.length ? referrals.map((item) => <article key={item.id}>
            <div>
              <b>{item.kind === 'landlord' ? 'Landlord' : 'Property'} · {item.contact_name}</b>
              <p>{item.neighbourhood}, {item.city} · {item.phone}</p>
              <p>{item.detail}</p>
              <small>Submitted by {item.user_email} · {item.credits} credits if accepted</small>
            </div>
            <div className="admin-actions">
              <button className="primary" type="button" disabled={busy === item.id} onClick={() => review('referral', item.id, 'accepted')}>Accept</button>
              <button className="secondary" type="button" disabled={busy === item.id} onClick={() => review('referral', item.id, 'rejected')}>Decline</button>
            </div>
          </article>) : <p>No referrals are waiting for review.</p>}

          <h2>Published homes <span>{published.length}</span></h2>
          <p className="muted">Mark a home as taken once it is rented or sold. It disappears from search and alerts, and its contact closes.</p>
          {published.map((item) => <article key={item.id}>
            <div>
              <b>{item.title}{item.sample ? ' (sample)' : ''}</b>
              <p>{item.neighbourhood}, {item.city} · {priceLine(item)}</p>
              <span className={`status-pill ${item.available === false ? 'taken' : 'live'}`}>{item.available === false ? 'Taken' : 'Available'}</span>
              <PinEditor item={item} member={member} onSaved={async (text) => { setMessage(text); await load(); await onPublished?.() }} onError={setError} />
            </div>
            <div className="admin-actions">
              <button className={item.available === false ? 'primary' : 'secondary'} type="button" disabled={busy === String(item.id)} onClick={() => setAvailable(item)}>{busy === String(item.id) ? 'Saving…' : item.available === false ? 'Mark available' : 'Mark as taken'}</button>
            </div>
          </article>)}
        </div>
      </>
    )}
  </section>
}
