import { useEffect, useState } from 'react'

// Listing photo that falls back to the house icon if the image cannot load.
export function Photo({ src, alt = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) return <span className="property-icon" aria-hidden="true">⌂</span>
  return <img className="listing-photo" src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}
import { groupDigits, priceLine, PERIODS, formatFcfa, toAmount } from './price.js'
import { isAvailable } from './filters.js'

// Internal link that keeps the single-page app snappy but still works as a normal link
// (middle-click, open in new tab, search engines).
export function Link({ to, navigate, className, children, ...rest }) {
  return <a
    href={to}
    className={className}
    onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate(to)
    }}
    {...rest}
  >{children}</a>
}

// Full FCFA amount with thousands separators added as the user types.
export function PriceInput({ value, onChange, ...rest }) {
  return <input
    type="text"
    inputMode="numeric"
    autoComplete="off"
    value={value ? groupDigits(String(value)) : ''}
    onChange={(event) => onChange(toAmount(event.target.value))}
    {...rest}
  />
}

export function PasswordInput({ id, value, onChange, shown, onToggle, autoComplete, minLength = 8 }) {
  return <span className="password-field">
    <input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} required minLength={minLength} value={value} onChange={onChange} />
    <button type="button" className="reveal" onClick={onToggle} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>{shown ? 'Hide' : 'Show'}</button>
  </span>
}

export function statusBadge(listing) {
  if (!isAvailable(listing)) return { text: 'Taken', tone: 'tone-taken' }
  if (listing.sample) return { text: 'Sample', tone: 'tone-sample' }
  if (listing.status === 'pending') return { text: 'Pending review', tone: 'tone-pending' }
  return { text: 'Verified', tone: 'tone-verified' }
}

export function ListingCard({ listing, onOpen, saved, onSave }) {
  const badge = statusBadge(listing)
  const taken = !isAvailable(listing)
  return <article className={`listing-card${taken ? ' is-taken' : ''}`}>
    <a className="listing-link" href={`/homes/${encodeURIComponent(listing.id)}`} onClick={(event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
      event.preventDefault()
      onOpen(listing)
    }}>
      <div className="listing-image" style={{ '--hue': listing.hue }}>
        <span className={`badge ${badge.tone}`}>{badge.text}</span>
        <Photo src={listing.photos?.[0]} />
      </div>
      <div className="listing-copy">
        <h3>{listing.title}</h3>
        <p>{listing.neighbourhood}, {listing.city}</p>
        <strong className="price">{priceLine(listing)}</strong>
        {listing.period === 'year' ? <small className="price-note">About {formatFcfa(listing.price / 12)} a month</small> : null}
        <div className="meta">
          <span>{listing.type}</span>
          {listing.beds ? <span>{listing.beds} {listing.beds === 1 ? 'bed' : 'beds'}</span> : null}
          {listing.baths ? <span>{listing.baths} {listing.baths === 1 ? 'bath' : 'baths'}</span> : null}
          {listing.size ? <span>{listing.size} m²</span> : null}
        </div>
      </div>
    </a>
    <button type="button" className={`heart ${saved ? 'saved' : ''}`} onClick={() => onSave(listing.id)} aria-label={saved ? 'Remove from saved' : 'Save property'} aria-pressed={saved}>{saved ? '♥' : '♡'}</button>
  </article>
}

export function Modal({ title, children, onClose, actions }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-icon" aria-hidden="true">✓</div>
      <h2 id="modal-title">{title}</h2>
      {children}
      <div className="modal-actions">{actions}</div>
    </div>
  </div>
}

export function periodWord(listing) {
  return PERIODS[listing.period]?.long || ''
}
