import { useEffect, useState } from 'react'
import { Link, ListingCard } from './ui.jsx'
import { homesLink } from './filters.js'

function devicePermission() {
  return typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
}

export default function Notifications({ member, data, onSeen, onDelete, onOpen, savedIds, onSave, navigate, go }) {
  const [permission, setPermission] = useState(devicePermission)
  const [busy, setBusy] = useState('')
  const alerts = data.alerts || []
  const unread = data.unread || 0

  // Opening this page counts as reading the notifications. The "New" labels stay visible until the next visit.
  useEffect(() => {
    if (member?.token && unread > 0) onSeen()
  }, [member?.token, unread])

  const askPermission = async () => {
    if (permission === 'unsupported') return
    const result = await window.Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') new window.Notification('Findam notifications are on', { body: 'We will tell you here when new homes match your alerts.' })
  }

  if (!member) return <section className="shell section narrow">
    <p className="kicker">NOTIFICATIONS</p>
    <h1 className="page-title">Get told when the right home appears</h1>
    <p className="lead">Search for a home, then press <b>Notify me of new matches</b>. When a matching home is published, it shows up here and on the bell at the top of every page.</p>
    <div className="empty-actions"><button className="primary" onClick={() => go('account')}>Create a free account</button><button className="secondary" onClick={() => go('listings')}>Search homes</button></div>
  </section>

  const seen = new Set()
  const matches = alerts.flatMap((alert) => alert.matches || []).filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))

  return <section className="shell section">
    <p className="kicker">NOTIFICATIONS</p>
    <h1 className="page-title">Your home alerts</h1>
    <p className="lead">New homes that match your saved searches appear here. Homes that have been taken are removed automatically.</p>

    {permission !== 'unsupported' ? <div className={`notice-card${permission === 'granted' ? ' on' : ''}`}>
      <div><b>{permission === 'granted' ? 'Device notifications are on' : 'Get a pop-up on this phone or computer'}</b>
        <p>{permission === 'granted' ? 'While Findam is open in your browser, we show a pop-up when a new match arrives.' : permission === 'denied' ? 'Notifications are blocked in your browser settings. Allow them for usefindam.com to turn this on.' : 'Allow notifications and we will show a pop-up when a new matching home is published.'}</p></div>
      {permission === 'default' ? <button className="primary" onClick={askPermission}>Turn on</button> : null}
    </div> : null}

    {data.error ? <p className="admin-error" role="alert">{data.error}</p> : null}

    <h2 className="section-title">New homes for you</h2>
    {data.loading && !alerts.length ? <p role="status">Loading your alerts…</p> : matches.length ? <div className="cards">{matches.map((item) => <div className="match" key={item.id}>{item.fresh ? <span className="new-pill">New</span> : null}<ListingCard listing={item} onOpen={onOpen} saved={savedIds.includes(item.id)} onSave={onSave} /></div>)}</div> : <div className="empty small"><p>{alerts.length ? 'No new matching homes yet. We will show them here as soon as an admin publishes one.' : 'You have no alerts yet.'}</p></div>}

    <h2 className="section-title">Saved alerts <span className="count-pill">{alerts.length}</span></h2>
    {alerts.length ? <ul className="alert-list">{alerts.map((alert) => <li key={alert.id}>
      <div><b>{alert.label}</b><small>Saved {new Date(alert.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {(alert.matches || []).length} new {(alert.matches || []).length === 1 ? 'match' : 'matches'}</small></div>
      <div className="alert-actions">
        <Link to={homesLink(alert.filters)} navigate={navigate} className="secondary">See results</Link>
        <button type="button" className="text-button danger" disabled={busy === alert.id} onClick={async () => { setBusy(alert.id); await onDelete(alert.id); setBusy('') }}>{busy === alert.id ? 'Deleting…' : 'Delete'}</button>
      </div>
    </li>)}</ul> : <div className="empty small"><p>Search for homes and press <b>Notify me of new matches</b> to create your first alert.</p><button className="primary" onClick={() => go('listings')}>Search homes</button></div>}
  </section>
}
