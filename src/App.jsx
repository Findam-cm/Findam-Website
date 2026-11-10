import { useEffect, useMemo, useRef, useState } from 'react'
import { cities, desks, listings } from './data.js'
import SearchMap from './SearchMap.jsx'
import Account from './Account.jsx'
import Refer, { authHeadersFor } from './Refer.jsx'
import Admin from './Admin.jsx'
import { authClient } from './auth.js'

const money = (value) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value / 1000)}k FCFA`

const PAGES = {
  '/': 'home',
  '/homes': 'listings',
  '/cities': 'agents',
  '/saved': 'saved',
  '/account': 'account',
  '/admin': 'admin',
  '/list': 'list',
  '/how-it-works': 'workflow',
  '/refer': 'refer',
}

function pathFor(page) {
  return Object.entries(PAGES).find(([, name]) => name === page)?.[0] || '/'
}

function locationState(catalog) {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const match = path.match(/^\/homes\/([^/]+)$/)
  if (match) {
    const id = decodeURIComponent(match[1])
    const listing = catalog.find((item) => String(item.id) === id) || null
    return { page: listing ? 'detail' : 'listings', listing }
  }
  return { page: PAGES[path] || 'home', listing: null }
}

function Logo() {
  return <span className="logo-mark"><span className="roof">⌂</span>Findam</span>
}

function ListingCard({ listing, onOpen, saved, onSave }) {
  return <article className="listing-card" onClick={() => onOpen(listing)} role="button" tabIndex="0" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(listing) } }}>
    <div className="listing-image" style={{ '--hue': listing.hue }}>
      <span className="badge">{listing.sample ? 'Sample' : listing.status === 'pending' ? 'Pending review' : 'Verified'}</span><button className={`heart ${saved ? 'saved' : ''}`} onClick={(event) => { event.stopPropagation(); onSave(listing.id) }} aria-label="Save property">{saved ? '♥' : '♡'}</button>{listing.photos?.[0] ? <img className="listing-photo" src={listing.photos[0]} alt="" /> : <span className="property-icon">⌂</span>}
    </div>
    <div className="listing-copy">
      <h3>{listing.title}</h3><p>{listing.neighbourhood}, {listing.city}</p>
      <strong>{money(listing.price)}{listing.period !== 'sale' && ` / ${listing.period}`}</strong>
      <div className="meta">{listing.beds ? <span>▱ {listing.beds} Beds</span> : null}{listing.baths ? <span>♧ {listing.baths} Baths</span> : null}{listing.size ? <span>□ {listing.size} m²</span> : null}</div>
    </div>
  </article>
}

function SearchFields({ city, setCity, type, setType, allowAny = true }) {
  return <>
    <label><span>Where are you looking?</span><select name="city" required={!allowAny} value={city} onChange={(e) => setCity(e.target.value)}><option value="">{allowAny ? 'Any city' : 'Choose a city'}</option>{cities.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label><span>Property type</span><select name="type" value={type} onChange={(e) => setType(e.target.value)}>{allowAny && <option value="">Any</option>}<option>Rent</option><option>Sale</option><option>Guest house</option></select></label>
  </>
}

function App() {
  const starting = locationState(listings)
  const [page, setPage] = useState(starting.page)
  const [city, setCity] = useState('')
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(starting.listing)
  const [maxPrice, setMaxPrice] = useState('')
  const [savedIds, setSavedIds] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('findam-saved') || '[]')
      return Array.isArray(stored) ? stored : []
    } catch {
      return []
    }
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const listingsRef = useRef(listings)
  const [liveListings, setLiveListings] = useState(listings)
  listingsRef.current = liveListings
  const [member, setMember] = useState(null)
  const [creditScore, setCreditScore] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [adminAccess, setAdminAccess] = useState('checking')
  useEffect(() => {
    let ignore = false
    fetch('/api/listings')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (ignore || !Array.isArray(payload.listings)) return
        setLiveListings(payload.listings)
      })
      .catch(() => {})
    return () => { ignore = true }
  }, [])
  useEffect(() => {
    let ignore = false
    authClient.getSession().then((result) => {
      if (ignore) return
      const session = result.data?.session
      const user = result.data?.user
      setMember(session?.token && user ? { token: session.token, email: user.email, name: user.name } : null)
      setAuthReady(true)
    }).catch(() => { if (!ignore) setAuthReady(true) })
    return () => { ignore = true }
  }, [])
  useEffect(() => {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    if (!member?.token) {
      document.cookie = `findam_session=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      return
    }
    document.cookie = `findam_session=${encodeURIComponent(member.token)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`
  }, [member])
  useEffect(() => {
    if (!member?.token) {
      setCreditScore(null)
      setAdminAccess(authReady ? 'signed-out' : 'checking')
      return undefined
    }
    let ignore = false
    setAdminAccess('checking')
    fetch('/api/credits', { headers: authHeadersFor(member) })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Admin access could not be verified.')
        if (ignore) return
        setCreditScore(payload)
        setAdminAccess(payload.admin ? 'admin' : 'not-admin')
      })
      .catch(() => { if (!ignore) setAdminAccess('unavailable') })
    return () => { ignore = true }
  }, [member, authReady])
  const results = useMemo(() => liveListings.filter((listing) => (!city || listing.city === city) && (!type || listing.type === type) && (!maxPrice || listing.price <= Number(maxPrice) * 1000) && `${listing.title} ${listing.city} ${listing.neighbourhood}`.toLowerCase().includes(query.toLowerCase())), [liveListings, city, type, query, maxPrice])
  useEffect(() => {
    const next = locationState(liveListings)
    if (next.listing) setSelected(next.listing)
  }, [liveListings])
  useEffect(() => {
    const onPop = () => {
      const next = locationState(listingsRef.current)
      setPage(next.page)
      setSelected(next.listing)
      setMenuOpen(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const visit = (url) => {
    if (window.location.pathname !== url) {
      const depth = (window.history.state?.depth || 0) + 1
      window.history.pushState({ depth }, '', url)
    }
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const go = (next) => { setPage(next); setSelected(null); visit(pathFor(next)) }
  const showListing = (listing) => { setSelected(listing); setPage('detail'); visit(`/homes/${encodeURIComponent(listing.id)}`) }
  const showHomes = () => { setType(''); go('listings') }
  const backToListings = () => { if (window.history.state?.depth > 0) window.history.back(); else go('listings') }
  const chooseType = (choice) => { setType(choice); go('listings') }
  const toggleSaved = (id) => setSavedIds((current) => {
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    localStorage.setItem('findam-saved', JSON.stringify(next))
    return next
  })
  const refreshPublicListings = async () => {
    const response = await fetch('/api/listings')
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !Array.isArray(payload.listings)) {
      throw new Error(payload.error || 'The public listings could not be refreshed.')
    }
    setLiveListings(payload.listings)
  }

  return <>
    <header><div className="nav shell">
      <button className="brand" onClick={() => go('home')}><Logo /></button>
      <button className="menu" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="site-nav" aria-label="Toggle navigation">☰</button>
      <nav id="site-nav" className={menuOpen ? 'open' : ''}>
        <button className={page === 'home' ? 'active' : ''} onClick={() => go('home')}>Homes</button><button className={(page === 'listings' || page === 'detail') ? 'active' : ''} onClick={showHomes}>Property listings</button><button className={page === 'agents' ? 'active' : ''} onClick={() => go('agents')}>Agent</button><button className={page === 'refer' ? 'active' : ''} onClick={() => go('refer')}>Refer</button>{adminAccess === 'admin' && <button className={page === 'admin' ? 'active' : ''} onClick={() => go('admin')}>Admin</button>}<button className={page === 'saved' ? 'active' : ''} onClick={() => go('saved')}>Saved</button><button className={page === 'account' ? 'active' : ''} onClick={() => go('account')}>Account</button>
      </nav>
      <button className="primary compact" onClick={() => go('list')}>List a property</button>
    </div></header>
    <main>
      {page === 'home' && <Home listings={liveListings} city={city} setCity={setCity} type={type} setType={setType} maxPrice={maxPrice} setMaxPrice={setMaxPrice} search={() => go('listings')} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} go={go} />}
      {page === 'listings' && <Listings results={results} city={city} setCity={setCity} type={type} setType={setType} maxPrice={maxPrice} setMaxPrice={setMaxPrice} query={query} setQuery={setQuery} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} />}
      {page === 'detail' && <Detail listing={selected} back={backToListings} member={member} score={creditScore} onScore={setCreditScore} go={go} />}
      {page === 'agents' && <Agents go={go} />}
      {page === 'list' && <ListProperty member={member} go={go} onMember={setMember} />}
      {page === 'workflow' && <Workflow go={go} />}
      {page === 'saved' && <Saved listings={liveListings.filter((listing) => savedIds.includes(listing.id))} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} go={go} />}
      {page === 'account' && <Account member={member} onMember={setMember} />}
      {page === 'refer' && <Refer member={member} onScore={setCreditScore} onPublished={refreshPublicListings} />}
      {page === 'admin' && <Admin member={member} authReady={authReady} access={adminAccess} onPublished={refreshPublicListings} />}
    </main>
    <HelpBot go={go} chooseType={chooseType} />
    <footer><div className="shell footer"><div><Logo /><p>Find verified properties. Move in with confidence.</p></div><div><b>Explore</b><button onClick={() => chooseType('Rent')}>Rent a home</button><button onClick={() => go('agents')}>Agent</button><button onClick={() => go('workflow')}>How it works</button><button onClick={() => go('refer')}>Refer</button></div><div><b>Available cities</b>{cities.map((item) => <span key={item}>{item}</span>)}</div></div><p className="copyright">© {new Date().getFullYear()} FindamCameroon. All rights reserved. Original listing text, the Findam name, and this site layout belong to FindamCameroon. Map imagery is supplied by Google under the Google Maps Platform terms and remains Google’s property.</p></footer>
  </>
}

function Home({ listings: homeListings, city, setCity, type, setType, maxPrice, setMaxPrice, search, onOpen, savedIds, onSave, go }) { return <>
  <section className="hero"><div className="shell hero-grid"><div className="hero-copy">
    <h1>Find Verified Properties.<br />Move in with <em>Confidence.</em></h1><p>Findam connects house seekers, landlords, civil engineers and agents on one trusted platform.</p>
    <div className="type-tabs"><button className={!type || type === 'Rent' ? 'selected' : ''} onClick={() => setType('Rent')}>For Rent</button><button className={type === 'Sale' ? 'selected' : ''} onClick={() => setType('Sale')}>For Sale</button><button className={type === 'Guest house' ? 'selected' : ''} onClick={() => setType('Guest house')}>Guest house</button></div>
    <form className="search-bar" onSubmit={(event) => { event.preventDefault(); search() }}><SearchFields {...{ city, setCity, type, setType }} /><label><span>Max price (thousand FCFA)</span><input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="e.g. 150" /></label><button className="primary">⌕ Search</button></form>
    <div className="trust-strip"><Trust icon="♢" title="Accepted listings" text="Public only after an admin accepts" /><Trust icon="♙" title="City coverage" text="Bamenda, Buea and Yaounde" /><Trust icon="♙" title="Credits" text="Refer a home to open contacts" /><Trust icon="▣" title="Easy Access" text="Website and Findam Bot" /></div>
  </div><div className="hero-visual"><div className="hero-photo" /><div className="verified-float">✓ <span>Agent visited<br />Engineer reviewed</span></div></div></div></section>
  <section className="shell featured section"><div className="section-head"><h2>Featured listings</h2><button className="text-button" onClick={() => go('listings')}>View all listings →</button></div><div className="cards">{homeListings.filter((item) => item.featured).map((item) => <ListingCard key={item.id} listing={item} onOpen={onOpen} saved={savedIds.includes(item.id)} onSave={onSave} />)}</div></section>
  <section className="shell role-section"><Role icon="⌂" title="I'm a Landlord" text="List your property and get serious tenants faster." action="List Property" onClick={() => go('list')} /><Role icon="⌕" title="I'm a House Seeker" text="Find verified properties that match your needs." action="Start Searching" onClick={() => go('listings')} /><Role icon="♙" title="I'm an Agent" text="Join our network of trusted house finders." action="See cities" onClick={() => go('agents')} /></section>
  <section className="workflow-preview"><div className="shell"><p className="kicker">HOW FINDAM WORKS</p><h2>Verified from visit to move-in.</h2><div className="steps"><Step number="1" title="Search" text="Find a home by city, budget and type." /><Step number="2" title="Browse accepted homes" text="Only homes an admin has accepted appear publicly. Sample cards are marked." /><Step number="3" title="Contact agent" text="Connect with the assigned house finder." /><Step number="4" title="Schedule viewing" text="Choose a time to see the home." /><Step number="5" title="Move in" text="Your agent supports the handover." /></div></div></section>
  </> }

function Trust({ icon, title, text }) { return <div className="trust"><i>{icon}</i><span><b>{title}</b><small>{text}</small></span></div> }
function Role({ icon, title, text, action, onClick }) { return <article className="role"><i>{icon}</i><div><h3>{title}</h3><p>{text}</p><button onClick={onClick}>{action} →</button></div></article> }
function Step({ number, title, text }) { return <article><b>{number}</b><h3>{title}</h3><p>{text}</p></article> }

function Listings({ results, city, setCity, type, setType, maxPrice, setMaxPrice, query, setQuery, onOpen, savedIds, onSave }) { return <section className="shell section"><p className="kicker">VERIFIED LISTINGS</p><h1 className="page-title">Find your next home</h1><div className="filters"><SearchFields {...{ city, setCity, type, setType }} /><label><span>Max price (thousand FCFA)</span><input type="number" min="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="e.g. 150" /></label><label><span>Search location or property</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Molyko" /></label></div><p className="result-count">{results.length} {results.length === 1 ? 'property' : 'properties'} found</p><SearchMap city={city} query={query} listings={results} onOpen={onOpen} /><div className="cards">{results.map((item) => <ListingCard key={item.id} listing={item} onOpen={onOpen} saved={savedIds.includes(item.id)} onSave={onSave} />)}</div>{!results.length && <div className="empty">No properties match these filters. Try another city or property type.</div>}</section> }
function Detail({ listing, back, member, score, onScore, go }) {
  const [contact, setContact] = useState(null)
  const [contactError, setContactError] = useState('')
  const [opening, setOpening] = useState(false)
  if (!listing) return null
  const freeFinder = (score?.freeFinder) || (score?.score >= 5)
  const openContact = async () => {
    if (!member) { go('account'); return }
    setOpening(true)
    setContactError('')
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(listing.id)}/contact`, { method: 'POST', headers: authHeadersFor(member) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The contact could not be opened.')
      setContact(payload)
      onScore?.((current) => ({ ...(current || {}), score: payload.score, freeFinder: payload.freeFinder }))
    } catch (error) {
      setContactError(error.message || 'The contact could not be opened.')
    } finally {
      setOpening(false)
    }
  }
  return <section className="shell section"><button className="text-button" onClick={back}>← Back to listings</button><div className="detail"><div><div className="detail-image" style={{ '--hue': listing.hue }}><span className="badge">{listing.sample ? 'Sample' : listing.status === 'pending' ? 'Pending review' : 'Verified'}</span>{listing.photos?.[0] ? <img className="listing-photo" src={listing.photos[0]} alt="" /> : <span className="property-icon">⌂</span>}</div><p className="kicker">{listing.type} · {listing.city}</p><h1 className="page-title">{listing.title}</h1><p className="lead">{listing.description}</p><div className="facts">{listing.beds ? <span>{listing.beds} Bedrooms</span> : null}{listing.baths ? <span>{listing.baths} Bathrooms</span> : null}{listing.size ? <span>{listing.size} m²</span> : null}</div><SearchMap compact city={listing.city} query={listing.neighbourhood} listings={[listing]} /></div><aside><p className="kicker">PRICE</p><h2>{money(listing.price)}</h2><p>per {listing.period}</p>{contact ? <div className="verified">{contact.phone ? `Landlord: ${contact.phone}` : 'A house finder will arrange this viewing. Your credits cover the request.'}</div> : <button className="primary" onClick={openContact} disabled={opening}>{!member ? 'Sign in to open contact' : listing.sample ? 'Open sample contact' : freeFinder ? 'Open contact free' : opening ? 'Opening…' : 'Use 1 credit to open contact'}</button>}{contactError ? <p className="photo-note">{contactError}</p> : null}<p className="credit-hint">{freeFinder ? 'Your referral score opens contacts for free.' : 'Refer a property and a landlord to reach 5 credits and open contacts for free.'}</p>{listing.sample ? <div className="verified">Sample listing. A house finder has not inspected this home, and opening it does not spend credits.</div> : <div className="verified">Accepted by an admin and visible to house seekers.</div>}</aside></div></section>
}
function Agents({ go }) { return <section className="shell section"><p className="kicker">HOUSE FINDERS</p><h1 className="page-title">Findam in each city</h1><p className="lead">Viewings are arranged from a listing after you open the contact. These desks are coverage areas, not named staff.</p><div className="agent-grid">{desks.map((desk) => <article className="agent" key={desk.city}><div className="avatar">{desk.initials}</div><h3>Findam {desk.city}</h3><p>{desk.text}</p><button className="secondary" onClick={() => go('listings')}>Browse homes</button></article>)}</div></section> }
function ListProperty({ member, go, onMember }) {
  const [sent, setSent] = useState(false)
  const [city, setCity] = useState('')
  const [type, setType] = useState('Rent')
  const [neighbourhood, setNeighbourhood] = useState('')
  const [photos, setPhotos] = useState([])
  const [photoNote, setPhotoNote] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const allowedPhotos = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  const addPhotos = (event) => {
    const files = Array.from(event.target.files || []).slice(0, 6)
    const accepted = []
    const rejected = []
    files.forEach((file) => { if (!allowedPhotos.has(file.type) || file.size > 5 * 1024 * 1024) rejected.push(file.name); else accepted.push(file) })
    setPhotos((current) => { current.forEach((photo) => URL.revokeObjectURL(photo.url)); return accepted.map((file) => ({ name: file.name, url: URL.createObjectURL(file), file })) })
    setPhotoNote(rejected.length ? 'Use JPEG, PNG, WEBP, or GIF files of 5 MB or less. Some files were skipped.' : '')
  }
  const submit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    setSaving(true)
    setSubmitError('')
    try {
      let token = member?.token || ''
      try {
        const session = await authClient.getSession()
        const fresh = session.data?.session?.token
        const user = session.data?.user
        if (fresh && user) {
          token = fresh
          onMember?.({ token: fresh, email: user.email, name: user.name })
        }
      } catch {}
      if (!token) { go('account'); return }
      const body = new FormData(form)
      photos.forEach((photo) => body.append('photos', photo.file))
      body.set('sessionToken', token)
      const response = await fetch('/api/listings', { method: 'POST', credentials: 'include', headers: { authorization: `Bearer ${token}` }, body })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 401) throw new Error('Your sign-in expired. Open Account and sign in again, then submit this property.')
      if (!response.ok) throw new Error(payload.error || 'The listing could not be saved.')
      setSent(true)
    } catch (error) {
      setSubmitError(error.message || 'The listing store is not reachable.')
    } finally {
      setSaving(false)
    }
  }
  if (!member) return <section className="shell section"><div className="form-wrap"><p className="kicker">LANDLORD PORTAL</p><h1 className="page-title">List your property</h1><p className="lead">Sign in before sending a property. An admin reviews it, and it stays off the public site until it is accepted.</p><button className="primary" onClick={() => go('account')}>Go to Account</button></div></section>
  return <section className="shell section"><div className="form-wrap"><p className="kicker">LANDLORD PORTAL</p><h1 className="page-title">List your property</h1><p className="lead">Submit your details and photos. An admin reviews the property before it appears publicly.</p>{sent ? <div className="success"><h2>Sent for admin review</h2><p>The property stays off the public site until an admin accepts it.</p></div> : <form className="property-form" onSubmit={submit}><label>Property title<input name="title" required placeholder="e.g. 2 Bedroom Apartment" /></label><SearchFields allowAny={false} {...{ city, setCity, type, setType }} /><label>Neighbourhood<input name="neighbourhood" required value={neighbourhood} onChange={(event) => setNeighbourhood(event.target.value)} placeholder="e.g. Molyko" /></label><label>Price (thousand FCFA)<input name="price" required type="number" min="1" placeholder="e.g. 150" /><small>Enter 150 for 150,000 FCFA.</small></label><label>Phone number<input name="phone" required type="tel" placeholder="+237" /></label><label className="photo-upload">Property photos<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={addPhotos} /><span>Upload up to 6 JPEG, PNG, WEBP, or GIF photos</span></label>{photoNote && <p className="photo-note">{photoNote}</p>}{photos.length > 0 && <div className="photo-previews">{photos.map((photo) => <img src={photo.url} alt={photo.name} key={photo.url} />)}</div>}{submitError && <p className="photo-note">{submitError}</p>}<button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Submit for review'}</button></form>}</div></section>
}
function Workflow({ go }) { return <section className="shell section"><p className="kicker">THE FINDAM WORKFLOW</p><h1 className="page-title">One trusted workflow for every listing.</h1><div className="workflow-grid"><article><span>01</span><h2>Landlord submits</h2><p>Sign in and send the property details, photos and price.</p></article><article><span>02</span><h2>Admin reviews</h2><p>The listing stays off the public site until an admin accepts it.</p></article><article><span>03</span><h2>Published</h2><p>The accepted property becomes visible on the website.</p></article><article><span>04</span><h2>Viewing</h2><p>A signed-in member opens the contact, and a house finder arranges the visit.</p></article></div><div className="bot-callout"><div><p className="kicker">FINDAM BOT</p><h2>Ask on this site.</h2><p>Search properties or list a home from the site. A WhatsApp line will be added when Findam publishes its own number.</p></div></div><button className="primary" onClick={() => go('list')}>List a property</button></section> }

function Saved({ listings, onOpen, savedIds, onSave, go }) { return <section className="shell section"><p className="kicker">YOUR SHORTLIST</p><h1 className="page-title">Saved properties</h1>{listings.length ? <div className="cards saved-grid">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} onOpen={onOpen} saved={savedIds.includes(listing.id)} onSave={onSave} />)}</div> : <div className="empty">You have not saved any properties yet.<br /><button className="primary" onClick={() => go('listings')}>Browse verified listings</button></div>}</section> }

function HelpBot({ go, chooseType }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([{ from: 'bot', text: 'Hi! I am Findam Bot. Ask about homes, prices, verification or listing a property.' }])
  const botReply = (text) => {
    const value = text.toLowerCase()
    if (value.includes('verif') || value.includes('safe')) return 'A new listing stays off the public site until an admin accepts it. Homes marked Sample are demo data, not inspected properties.'
    if (value.includes('guest') || value.includes('short let')) return 'Guest houses are furnished stays, usually priced per night. Choose Guest house in the search filters to see them.'
    if (value.includes('list') || value.includes('landlord') || value.includes('photo')) return 'Sign in, then submit the title, city, price and JPEG, PNG, WEBP or GIF photos. An admin reviews it before it appears publicly.'
    if (value.includes('city') || value.includes('location') || value.includes('map')) return 'Findam currently covers Bamenda, Buea and Yaounde. Filter by city or type a neighbourhood, and the listings page shows that place on the map.'
    if (value.includes('refer') || value.includes('credit') || value.includes('score')) return 'Refer a property or a landlord, then an admin reviews it. Accepted referrals add 2 credits for a property and 3 for a landlord. At 5 credits, property contacts open for free.'
    if (value.includes('agent') || value.includes('contact')) return 'Open a listing and use your credits to request the contact. Findam does not publish a phone number on this site yet.'
    return 'I can help with finding a home, listing a property, prices, verification, cities and referrals. Could you tell me a little more?'
  }
  const sendMessage = (event) => { event.preventDefault(); const text = message.trim(); if (!text) return; setMessages((current) => [...current, { from: 'user', text }, { from: 'bot', text: botReply(text) }]); setMessage('') }
  const quickReply = (text) => setMessages((current) => [...current, { from: 'user', text }, { from: 'bot', text: botReply(text) }])
  return <div className="bot-widget">
    {open && <section className="bot-panel"><header><span className="bot-logo">🤖</span><div><b>Findam Bot</b><small>Online · replies instantly</small></div><button onClick={() => setOpen(false)} aria-label="Close help">×</button></header><div className="bot-chat">{messages.map((item, index) => <p className={item.from} key={`${item.from}-${index}`}>{item.text}</p>)}</div><form className="bot-input" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type your message..." aria-label="Message Findam Bot" /><button type="submit" aria-label="Send message">➤</button></form><div className="bot-actions"><button onClick={() => quickReply('How are listings verified?')}>Verification</button><button onClick={() => quickReply('How do prices work?')}>Prices</button><button onClick={() => { chooseType('Rent'); setOpen(false) }}>Find a home</button><button onClick={() => { go('list'); setOpen(false) }}>List a property</button></div></section>}
    <button className="whatsapp" onClick={() => setOpen(!open)} aria-label="Open Findam Bot"><span className="floating-bot">🤖</span><span>Findam Bot</span></button>
  </div>
}

export default App
