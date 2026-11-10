import { useEffect, useState } from 'react'
import { authHeadersFor } from './Refer.jsx'

export default function Admin({ member, authReady, access, onPublished }) {
  const [referrals, setReferrals] = useState([])
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const headers = authHeadersFor(member)
      const [referralResponse, listingResponse] = await Promise.all([
        fetch('/api/admin/referrals', { headers }),
        fetch('/api/admin/listings', { headers }),
      ])
      const [referralPayload, listingPayload] = await Promise.all([
        referralResponse.json(),
        listingResponse.json(),
      ])
      if (!referralResponse.ok) throw new Error(referralPayload.error || 'Could not load referral reviews.')
      if (!listingResponse.ok) throw new Error(listingPayload.error || 'Could not load listing reviews.')
      setReferrals(referralPayload.referrals || [])
      setListings(listingPayload.listings || [])
    } catch (loadError) {
      setError(loadError.message || 'The admin dashboard could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (access === 'admin') load()
  }, [member?.token, access])

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
    <p className="lead">Review property submissions and referrals. Only the server-authorized root admin account can use these controls.</p>
    {!authReady || access === 'checking' ? <p role="status">Checking your admin access…</p> : !member ? (
      <div className="admin-setup">
        <h2>Sign in with your admin account</h2>
        <p>Configure <code>ROOT_ADMIN_EMAIL</code> on the backend, create an account using that exact email on the Account page, and sign in.</p>
        <ol>
          <li>For local development, set <code>ROOT_ADMIN_EMAIL</code> in <code>.env</code>, then run <code>node scripts/sync-neon-env.mjs</code> and restart the API.</li>
          <li>For the live site, set the <code>ROOT_ADMIN_EMAIL</code> secret in Cloudflare Workers.</li>
          <li>Create the account at <code>/account</code> with that email; set its password through Neon Auth, not an environment file.</li>
        </ol>
        <button className="primary" onClick={() => { window.location.href = '/account' }}>Go to Account</button>
      </div>
    ) : access === 'unavailable' ? (
      <div className="admin-setup" role="alert">
        <h2>Admin access could not be verified</h2>
        <p>The API could not confirm your role. Check that the backend is running and its database and Neon Auth configuration are available, then reload this page.</p>
      </div>
    ) : access !== 'admin' ? (
      <div className="admin-setup" role="status">
        <h2>This account is not an administrator</h2>
        <p>Signed in as {member.email}. Root-admin access is granted only when this email exactly matches the server-side <code>ROOT_ADMIN_EMAIL</code> setting. Do not send or store your password in environment files.</p>
        <ol>
          <li>Set <code>ROOT_ADMIN_EMAIL</code> to this account’s email in the Worker environment.</li>
          <li>For local development, set it in <code>.env</code> and run <code>node scripts/sync-neon-env.mjs</code>.</li>
          <li>For the live site, set it in Cloudflare Workers as a secret, then sign out and back in.</li>
        </ol>
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
              <p>{item.neighbourhood}, {item.city} · {item.type} · {new Intl.NumberFormat('en-US').format(item.price)} FCFA</p>
              <p>{item.phone}</p>
              <small>Submitted by {item.submittedEmail || 'unknown account'}</small>
              {item.description ? <p>{item.description}</p> : null}
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
        </div>
      </>
    )}
  </section>
}
