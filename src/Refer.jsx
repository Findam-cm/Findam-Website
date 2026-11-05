import { useEffect, useState } from 'react'
import { cities } from './data.js'

const empty = { contactName: '', phone: '', city: '', neighbourhood: '', detail: '' }

function authHeaders(member) {
  return member?.token ? { authorization: `Bearer ${member.token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }
}

export default function Refer({ member, onScore, onPublished }) {
  const [account, setAccount] = useState(null)
  const [property, setProperty] = useState(empty)
  const [landlord, setLandlord] = useState(empty)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [queue, setQueue] = useState([])
  const [listings, setListings] = useState([])

  const load = () => {
    if (!member?.token) {
      setAccount(null)
      return
    }
    fetch('/api/credits', { headers: authHeaders(member) })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        setAccount(payload)
        onScore?.(payload)
        if (!payload.admin) { setQueue([]); setListings([]); return }
        return Promise.all([
          fetch('/api/admin/referrals', { headers: authHeaders(member) }).then((response) => response.ok ? response.json() : { referrals: [] }),
          fetch('/api/admin/listings', { headers: authHeaders(member) }).then((response) => response.ok ? response.json() : { listings: [] }),
        ]).then(([review, properties]) => {
          setQueue(review.referrals || [])
          setListings(properties.listings || [])
        })
      })
      .catch(() => setAccount(null))
  }

  useEffect(() => { load() }, [member?.token])

  const submit = async (event, kind) => {
    event.preventDefault()
    if (!member?.token) return
    const form = kind === 'property' ? property : landlord
    setBusy(kind)
    setMessage('')
    try {
      const response = await fetch('/api/referrals', {
        method: 'POST',
        headers: authHeaders(member),
        body: JSON.stringify({ kind, ...form }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The referral could not be saved.')
      setAccount(payload)
      onScore?.(payload)
      if (kind === 'property') setProperty(empty)
      else setLandlord(empty)
      setMessage('Sent for admin review. Credits are added only after it is accepted.')
    } catch (error) {
      setMessage(error.message || 'The referral could not be saved.')
    } finally {
      setBusy('')
    }
  }

  const score = account?.score ?? 0
  const freeAt = account?.freeAt ?? 5

  return <section className="shell section">
    <p className="kicker">REFERRAL CREDITS</p>
    <h1 className="page-title">Refer a home or a landlord</h1>
    <p className="lead">An admin reviews each referral first. Credits are added only after it is accepted. At {freeAt} accepted credits, property contacts open without spending any more.</p>
    {!member ? <p className="photo-note">Sign in on the Account page before sending a referral.</p> : (
      <div className={`credit-score ${account?.freeFinder ? 'free' : ''}`}>
        <strong>{score}</strong>
        <span>{account?.freeFinder ? 'Free finder. Contacts on listings are open.' : `${Math.max(freeAt - score, 0)} more accepted credits until contacts are free.${account?.pendingCredits ? ` ${account.pendingCredits} are waiting for admin review.` : ''}`}</span>
      </div>
    )}
    <div className="referral-grid">
      <form className="property-form" onSubmit={(event) => submit(event, 'property')}>
        <h2>Refer a property</h2>
        <label>Contact name<input required value={property.contactName} onChange={(event) => setProperty({ ...property, contactName: event.target.value })} /></label>
        <label>Phone<input required type="tel" value={property.phone} onChange={(event) => setProperty({ ...property, phone: event.target.value })} placeholder="+237" /></label>
        <label>City<select required value={property.city} onChange={(event) => setProperty({ ...property, city: event.target.value })}><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select></label>
        <label>Neighbourhood<input required value={property.neighbourhood} onChange={(event) => setProperty({ ...property, neighbourhood: event.target.value })} /></label>
        <label>What is available?<textarea required value={property.detail} onChange={(event) => setProperty({ ...property, detail: event.target.value })} placeholder="e.g. Two bedrooms for rent in Molyko" /></label>
        <button className="primary" disabled={!member || busy === 'property'}>{busy === 'property' ? 'Saving…' : 'Submit property for review'}</button>
      </form>
      <form className="property-form" onSubmit={(event) => submit(event, 'landlord')}>
        <h2>Refer a landlord</h2>
        <label>Landlord name<input required value={landlord.contactName} onChange={(event) => setLandlord({ ...landlord, contactName: event.target.value })} /></label>
        <label>Phone<input required type="tel" value={landlord.phone} onChange={(event) => setLandlord({ ...landlord, phone: event.target.value })} placeholder="+237" /></label>
        <label>City<select required value={landlord.city} onChange={(event) => setLandlord({ ...landlord, city: event.target.value })}><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select></label>
        <label>Neighbourhood<input required value={landlord.neighbourhood} onChange={(event) => setLandlord({ ...landlord, neighbourhood: event.target.value })} /></label>
        <label>How do you know them?<textarea required value={landlord.detail} onChange={(event) => setLandlord({ ...landlord, detail: event.target.value })} placeholder="e.g. Owns rooms near the campus" /></label>
        <button className="primary" disabled={!member || busy === 'landlord'}>{busy === 'landlord' ? 'Saving…' : 'Submit landlord for review'}</button>
      </form>
    </div>
    {message ? <p className="photo-note" role="status">{message}</p> : null}
    {account?.admin ? <AdminQueue queue={queue} listings={listings} busy={busy} onReview={async (id, decision) => {
      setBusy(id)
      setMessage('')
      try {
        const response = await fetch(`/api/admin/referrals/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: authHeaders(member),
          body: JSON.stringify({ decision }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'The review could not be saved.')
        setMessage(decision === 'accepted' ? 'Referral accepted. Credits were added.' : 'Referral declined. No credits were added.')
        load()
      } catch (error) {
        setMessage(error.message || 'The review could not be saved.')
      } finally {
        setBusy('')
      }
    }} onListing={async (id, decision) => {
      setBusy(id)
      setMessage('')
      try {
        const response = await fetch(`/api/admin/listings/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: authHeaders(member),
          body: JSON.stringify({ decision }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'The listing review could not be saved.')
        setMessage(decision === 'accepted' ? 'Listing accepted. It is now public.' : 'Listing declined. It stays off the public site.')
        if (decision === 'accepted') onPublished?.()
        load()
      } catch (error) {
        setMessage(error.message || 'The listing review could not be saved.')
      } finally {
        setBusy('')
      }
    }} /> : null}
    {account?.referrals?.length ? <ul className="referral-list">{account.referrals.map((item) => <li key={item.id}><b>{item.kind === 'landlord' ? 'Landlord' : 'Property'}</b> · {item.contact_name}, {item.neighbourhood}<span>{item.status === 'accepted' ? `+${item.credits} accepted` : item.status === 'rejected' ? 'Declined' : 'Waiting for admin'}</span></li>)}</ul> : null}
  </section>
}

function AdminQueue({ queue, listings, busy, onReview, onListing }) {
  return <div className="admin-queue">
    <h2>Referral review</h2>
    {queue.length ? queue.map((item) => <article key={item.id}>
      <div><b>{item.kind === 'landlord' ? 'Landlord' : 'Property'}</b> · {item.contact_name}<p>{item.neighbourhood}, {item.city} · {item.phone}</p><p>{item.detail}</p><small>{item.user_email} · {item.credits} credits if accepted</small></div>
      <div className="admin-actions">
        <button className="primary" type="button" disabled={busy === item.id} onClick={() => onReview(item.id, 'accepted')}>Accept</button>
        <button className="secondary" type="button" disabled={busy === item.id} onClick={() => onReview(item.id, 'rejected')}>Decline</button>
      </div>
    </article>) : <p>No referrals are waiting.</p>}
    <h2>Listing review</h2>
    {listings.length ? listings.map((item) => <article key={item.id}>
      <div><b>{item.title}</b><p>{item.neighbourhood}, {item.city} · {item.type}</p><p>{item.phone}</p><small>{item.submittedEmail}</small></div>
      <div className="admin-actions">
        <button className="primary" type="button" disabled={busy === item.id} onClick={() => onListing(item.id, 'accepted')}>Accept</button>
        <button className="secondary" type="button" disabled={busy === item.id} onClick={() => onListing(item.id, 'rejected')}>Decline</button>
      </div>
    </article>) : <p>No listings are waiting.</p>}
  </div>
}

export function authHeadersFor(member) {
  return member?.token ? { authorization: `Bearer ${member.token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }
}
