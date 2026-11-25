import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Gallery, { preparePhoto } from './Gallery.jsx'
import { cities, desks, listings } from './data.js'
import SearchMap from './SearchMap.jsx'
import Account from './Account.jsx'
import Refer, { authHeadersFor } from './Refer.jsx'
import Admin from './Admin.jsx'
import Listings from './Listings.jsx'
import Notifications from './Notifications.jsx'
import PayReward from './PayReward.jsx'
import { PassModal, timeLeft, useClock } from './AccessPass.jsx'
import { answer } from './botBrain.js'
import { authClient } from './auth.js'
import { Link, ListingCard, Modal, PriceInput, statusBadge } from './ui.jsx'
import { filtersFromSearch, filtersToSearch, homesLink, isAvailable, matchesFilters, sortListings } from './filters.js'
import { PERIODS, budgetHint, budgetLabel, formatFcfa, priceLine } from './price.js'

const ExactMap = lazy(() => import('./ExactMap.jsx'))
const LocationPicker = lazy(() => import('./LocationPicker.jsx'))

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
  '/notifications': 'alerts',
}

const TITLES = {
  home: 'FindamCameroon | Verified homes in Bamenda, Buea and Yaounde',
  listings: 'Homes for rent and sale | Findam',
  agents: 'Findam house finders | Findam',
  saved: 'Saved homes | Findam',
  account: 'Your account | Findam',
  admin: 'Admin | Findam',
  list: 'List a property | Findam',
  workflow: 'How Findam works | Findam',
  refer: 'Refer a landlord | Findam',
  alerts: 'Notifications | Findam',
  notfound: 'Page not found | Findam',
  pay: 'Referral reward payment | Findam',
}

function pathFor(page) {
  return Object.entries(PAGES).find(([, name]) => name === page)?.[0] || '/'
}

function locationState(catalog, pathname = window.location.pathname) {
  const path = pathname.replace(/\/$/, '') || '/'
  if (/^\/pay\/[0-9a-f]{48}$/.test(path)) return { page: 'pay', listing: null }
  const match = path.match(/^\/homes\/([^/]+)$/)
  if (match) {
    const id = decodeURIComponent(match[1])
    const listing = catalog.find((item) => String(item.id) === id) || null
    return { page: 'detail', listing }
  }
  return { page: PAGES[path] || 'notfound', listing: null }
}

function Logo() {
  return <span className="logo-mark"><span className="roof" aria-hidden="true">⌂</span>Findam</span>
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" /></svg>
}

function MenuIcon({ open }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">{open
    ? <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
    : <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}</svg>
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(onClose, toast.long ? 7000 : 4500)
    return () => window.clearTimeout(timer)
  }, [toast])
  if (!toast) return null
  return <div className="toast" role="status"><span>{toast.text}</span>{toast.action ? <button type="button" onClick={() => { toast.action.run(); onClose() }}>{toast.action.label}</button> : null}<button type="button" className="toast-close" aria-label="Dismiss" onClick={onClose}>×</button></div>
}

function App() {
  const starting = locationState(listings)
  const [page, setPage] = useState(starting.page)
  const [filters, setFilters] = useState(() => filtersFromSearch(window.location.search))
  const [selected, setSelected] = useState(starting.listing)
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
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  listingsRef.current = liveListings
  const [member, setMember] = useState(null)
  const [referralCount, setReferralCount] = useState(0)
  const [passInfo, setPassInfo] = useState(null)
  const [passModal, setPassModal] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [adminAccess, setAdminAccess] = useState('checking')
  const [alertsData, setAlertsData] = useState({ alerts: [], unread: 0, loading: false, error: '' })
  const [alertState, setAlertState] = useState('')
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let ignore = false
    fetch('/api/listings')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (ignore || !Array.isArray(payload.listings)) return
        setLiveListings(payload.listings)
      })
      .catch(() => {})
      .finally(() => { if (!ignore) setCatalogLoaded(true) })
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
      setReferralCount(0)
      setAdminAccess(authReady ? 'signed-out' : 'checking')
      return undefined
    }
    let ignore = false
    setAdminAccess('checking')
    fetch('/api/account', { headers: authHeadersFor(member) })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Admin access could not be verified.')
        if (ignore) return
        setReferralCount((payload.referrals || []).length)
        setAdminAccess(payload.admin ? 'admin' : 'not-admin')
      })
      .catch(() => { if (!ignore) setAdminAccess('unavailable') })
    return () => { ignore = true }
  }, [member, authReady])

  // Access pass: price/duration for everyone, plus the member's active or pending pass.
  const loadPass = useCallback(async () => {
    try {
      const response = await fetch('/api/pass', { headers: authHeadersFor(member) })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload) setPassInfo(payload)
    } catch {}
  }, [member?.token])
  useEffect(() => { if (authReady) loadPass() }, [authReady, member?.token, loadPass])
  const passClock = useClock(passInfo?.active?.expiresAt, () => { loadPass(); setToast({ text: 'Your access pass has ended. All homes are locked again.', long: true }) })
  const passLeft = timeLeft(passInfo?.active?.expiresAt, passClock)

  const loadAlerts = useCallback(async () => {
    if (!member?.token) return
    setAlertsData((current) => ({ ...current, loading: true, error: '' }))
    try {
      const response = await fetch('/api/alerts', { headers: authHeadersFor(member) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Your alerts could not be loaded.')
      setAlertsData({ alerts: payload.alerts || [], unread: payload.unread || 0, loading: false, error: '' })
    } catch (error) {
      setAlertsData((current) => ({ ...current, loading: false, error: error.message }))
    }
  }, [member?.token])

  // Refresh alerts on sign-in, every two minutes while the tab is visible, and when the tab regains focus.
  useEffect(() => {
    if (!member?.token) { setAlertsData({ alerts: [], unread: 0, loading: false, error: '' }); return undefined }
    loadAlerts()
    const timer = window.setInterval(() => { if (!document.hidden) loadAlerts() }, 120000)
    const onVisible = () => { if (!document.hidden) loadAlerts() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [member?.token, loadAlerts])

  // A device pop-up when new matching homes arrive (only if the user allowed notifications).
  useEffect(() => {
    const unread = alertsData.unread
    if (!unread || !('Notification' in window) || window.Notification.permission !== 'granted') return
    let announced = 0
    try { announced = Number(sessionStorage.getItem('findam-announced') || 0) } catch {}
    if (unread <= announced) return
    try { sessionStorage.setItem('findam-announced', String(unread)) } catch {}
    const note = new window.Notification(`${unread} new ${unread === 1 ? 'home matches' : 'homes match'} your alerts`, { body: 'Open Findam to see them.', tag: 'findam-alerts' })
    note.onclick = () => { window.focus(); navigate('/notifications') }
  }, [alertsData.unread])

  const results = useMemo(
    () => sortListings(liveListings.filter((listing) => matchesFilters(listing, filters)), filters.sort, filters.budgetPeriod),
    [liveListings, filters],
  )

  // Direct links to listings that only exist on the server resolve once the live catalog arrives.
  useEffect(() => {
    const next = locationState(liveListings)
    if (next.page === 'detail') setSelected(next.listing)
  }, [liveListings])

  // Keep the address bar in step with the search so results can be shared and bookmarked.
  useEffect(() => {
    if (page !== 'listings') return
    const url = `/homes${filtersToSearch(filters)}`
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(window.history.state, '', url)
  }, [filters, page])

  useEffect(() => { setAlertState('') }, [filters])

  useEffect(() => {
    document.title = page === 'detail'
      ? (selected ? `${selected.title} in ${selected.neighbourhood}, ${selected.city} | Findam` : catalogLoaded ? 'Home not found | Findam' : 'Findam')
      : TITLES[page] || TITLES.home
  }, [page, selected, catalogLoaded])

  useEffect(() => {
    const onPop = () => {
      const next = locationState(listingsRef.current)
      if (next.page === 'listings') setFilters(filtersFromSearch(window.location.search))
      setPage(next.page)
      setSelected(next.listing)
      setMenuOpen(false)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const visit = (url) => {
    if (`${window.location.pathname}${window.location.search}` !== url) {
      const depth = (window.history.state?.depth || 0) + 1
      window.history.pushState({ depth }, '', url)
    }
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }
  const navigate = (url) => {
    const target = new URL(url, window.location.origin)
    const next = locationState(listingsRef.current, target.pathname)
    if (next.page === 'listings' && target.pathname.replace(/\/$/, '') === '/homes') setFilters(filtersFromSearch(target.search))
    setPage(next.page)
    setSelected(next.listing)
    visit(`${target.pathname}${target.search}`)
  }
  const go = (next) => {
    setPage(next)
    setSelected(null)
    visit(next === 'listings' ? `/homes${filtersToSearch(filters)}` : pathFor(next))
  }
  const updateFilters = (patch) => setFilters((current) => ({ ...current, ...patch }))
  const showListing = (listing) => { setSelected(listing); setPage('detail'); visit(`/homes/${encodeURIComponent(listing.id)}`) }
  const backToListings = () => { if (window.history.state?.depth > 0) window.history.back(); else go('listings') }
  const toggleSaved = (id) => setSavedIds((current) => {
    const adding = !current.includes(id)
    const next = adding ? [...current, id] : current.filter((item) => item !== id)
    try { localStorage.setItem('findam-saved', JSON.stringify(next)) } catch {}
    setToast({ text: adding ? 'Saved to your shortlist.' : 'Removed from your shortlist.', action: adding ? { label: 'View saved', run: () => navigate('/saved') } : null })
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
  const createAlert = async () => {
    if (!member?.token) {
      setToast({ text: 'Create a free account and we will tell you when a matching home is published.', long: true })
      go('account')
      return
    }
    setAlertState('saving')
    try {
      const response = await fetch('/api/alerts', { method: 'POST', headers: authHeadersFor(member), body: JSON.stringify({ filters }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The alert could not be saved.')
      setAlertState('saved')
      setToast({ text: `Alert saved: ${payload.alert.label}. New matches will appear on the bell.`, long: true, action: { label: 'Manage', run: () => navigate('/notifications') } })
      loadAlerts()
    } catch (error) {
      setAlertState('')
      setToast({ text: error.message, long: true })
    }
  }
  const deleteAlert = async (id) => {
    const response = await fetch(`/api/alerts/${encodeURIComponent(id)}/delete`, { method: 'POST', headers: authHeadersFor(member) })
    if (!response.ok) { setToast({ text: 'The alert could not be deleted. Try again.' }); return }
    setToast({ text: 'Alert deleted.' })
    await loadAlerts()
  }
  const markSeen = () => {
    setAlertsData((current) => ({ ...current, unread: 0 }))
    fetch('/api/alerts/seen', { method: 'POST', headers: authHeadersFor(member) }).catch(() => {})
  }

  const navLink = (to, name, label, extra) => <Link to={to} navigate={navigate} className={page === name || (name === 'listings' && page === 'detail') ? 'active' : ''} aria-current={page === name ? 'page' : undefined}>{label}{extra}</Link>

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header><div className="nav shell">
      <Link to="/" navigate={navigate} className="brand" aria-label="Findam home"><Logo /></Link>
      <nav id="site-nav" className={menuOpen ? 'open' : ''} aria-label="Main">
        {navLink('/', 'home', 'Home')}
        {navLink(homesLink(filters), 'listings', 'Property listings')}
        {navLink('/cities', 'agents', 'House finders')}
        {navLink('/refer', 'refer', 'Refer a landlord')}
        {adminAccess === 'admin' ? navLink('/admin', 'admin', 'Admin') : null}
        {navLink('/saved', 'saved', 'Saved', savedIds.length ? <span className="nav-count">{savedIds.length}</span> : null)}
        {navLink('/account', 'account', member ? 'Account' : 'Sign up / Sign in')}
        <Link to="/list" navigate={navigate} className="primary nav-list">List a property</Link>
      </nav>
      <div className="nav-actions">
        {!member && authReady ? <Link to="/account" navigate={navigate} className="signup-pill">Sign up</Link> : null}
        {member && passLeft && !passInfo?.admin ? <span className="pass-pill" title="Homes you can still unlock and time left on your pass">🔓 {passInfo.active.slotsLeft} left · {passLeft}</span> : null}
        {member ? <Link to="/notifications" navigate={navigate} className={`bell${page === 'alerts' ? ' active' : ''}`} aria-label={alertsData.unread ? `Notifications, ${alertsData.unread} new` : 'Notifications'}><BellIcon />{alertsData.unread ? <span className="bell-badge">{alertsData.unread > 9 ? '9+' : alertsData.unread}</span> : null}</Link> : null}
        <Link to="/list" navigate={navigate} className="primary compact">List a property</Link>
        <button className="menu" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="site-nav" aria-label={menuOpen ? 'Close menu' : 'Open menu'}><MenuIcon open={menuOpen} /></button>
      </div>
    </div></header>
    <main id="main">
      {page === 'home' && <Home listings={liveListings} filters={filters} update={updateFilters} search={() => go('listings')} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} go={go} navigate={navigate} />}
      {page === 'listings' && <Listings results={results} filters={filters} update={updateFilters} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} onAlert={createAlert} alertState={alertState} />}
      {page === 'detail' && <Detail listing={selected} loaded={catalogLoaded} all={liveListings} back={backToListings} member={member} go={go} navigate={navigate} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} passInfo={passInfo} passLeft={passLeft} onUnlock={() => setPassModal(true)} onPassChange={(active) => setPassInfo((current) => ({ ...(current || {}), active }))} />}
      {page === 'agents' && <Agents navigate={navigate} />}
      {page === 'list' && <ListProperty member={member} go={go} onMember={setMember} isAdmin={adminAccess === 'admin'} />}
      {page === 'workflow' && <Workflow go={go} />}
      {page === 'saved' && <Saved listings={liveListings.filter((listing) => savedIds.includes(listing.id))} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} go={go} />}
      {page === 'account' && <Account member={member} onMember={setMember} referralCount={referralCount} savedCount={savedIds.length} alertCount={alertsData.alerts.length} go={go} passInfo={passInfo} passLeft={passLeft} onUnlock={() => setPassModal(true)} listings={liveListings} onOpenListing={showListing} />}
      {page === 'refer' && <Refer member={member} go={go} />}
      {page === 'admin' && <Admin member={member} authReady={authReady} access={adminAccess} onPublished={refreshPublicListings} />}
      {page === 'notfound' && <section className="shell section narrow not-found"><p className="kicker">ERROR 404</p><h1 className="page-title">This page does not exist</h1><p className="lead">The link may be old or mistyped. Try one of these instead.</p><div className="empty-actions left"><Link to="/homes" navigate={navigate} className="primary">Browse homes</Link><Link to="/" navigate={navigate} className="secondary">Go to the home page</Link></div></section>}
      {page === 'pay' && <PayReward navigate={navigate} />}
      {page === 'alerts' && <Notifications member={member} data={alertsData} onSeen={markSeen} onDelete={deleteAlert} onOpen={showListing} savedIds={savedIds} onSave={toggleSaved} navigate={navigate} go={go} />}
    </main>
    <HelpBot go={go} navigate={navigate} passInfo={passInfo} />
    <Toast toast={toast} onClose={() => setToast(null)} />
    {passModal && member ? <PassModal member={member} settings={passInfo} onClose={() => setPassModal(false)} onActive={(data) => {
      setPassModal(false)
      loadPass()
      if (data?.active) setPassInfo((current) => ({ ...(current || {}), ...data, pending: null }))
      setToast({ text: `Pass active. Open the homes you like best and press “Unlock this home” (up to ${passInfo?.homes || 4} homes, ${passInfo?.hours || 48} hours).`, long: true })
    }} /> : null}
    <Footer navigate={navigate} />
  </>
}

function Footer({ navigate }) {
  const link = (to, label) => <li><Link to={to} navigate={navigate}>{label}</Link></li>
  return <footer><div className="shell footer">
    <div className="footer-brand"><Logo /><p>Find verified properties in Cameroon. Move in with confidence.</p><p className="footer-cta"><Link to="/list" navigate={navigate} className="primary">List a property</Link></p></div>
    <div><h2>Find a home</h2><ul>
      {link('/homes', 'All property listings')}
      {link(homesLink({ type: 'Rent' }), 'Homes for rent')}
      {link(homesLink({ type: 'Sale' }), 'Homes for sale')}
      {link(homesLink({ type: 'Guest house' }), 'Guest houses')}
      {link('/notifications', 'Home alerts')}
    </ul></div>
    <div><h2>Cities</h2><ul>
      {cities.map((city) => <li key={city}><Link to={homesLink({ city })} navigate={navigate}>Homes in {city}</Link></li>)}
      {link('/cities', 'House finders by city')}
    </ul></div>
    <div><h2>Findam</h2><ul>
      {link('/how-it-works', 'How it works')}
      {link('/list', 'List a property')}
      {link('/refer', 'Referral programme')}
      {link('/saved', 'Saved homes')}
      {link('/account', 'Your account')}
    </ul></div>
  </div><p className="copyright">© {new Date().getFullYear()} FindamCameroon. All rights reserved. Original listing text, the Findam name, and this site layout belong to FindamCameroon. Map imagery is supplied by Google under the Google Maps Platform terms and remains Google’s property.</p></footer>
}

function HeroSearch({ filters, update, search }) {
  const showPeriod = !filters.type || filters.type === 'Rent'
  return <form className="search-bar" onSubmit={(event) => { event.preventDefault(); search() }}>
    <label><span>Where are you looking?</span><select value={filters.city} onChange={(event) => update({ city: event.target.value })}><option value="">Any city</option>{cities.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label><span>Property type</span><select value={filters.type} onChange={(event) => update({ type: event.target.value })}><option value="">Any type</option><option>Rent</option><option>Sale</option><option>Guest house</option></select></label>
    <label className="budget-field"><span>{budgetLabel(filters.type, filters.budgetPeriod)}</span>
      <PriceInput value={filters.maxPrice} onChange={(maxPrice) => update({ maxPrice })} placeholder={filters.type === 'Sale' ? 'e.g. 25,000,000' : filters.type === 'Guest house' ? 'e.g. 25,000' : filters.budgetPeriod === 'year' ? 'e.g. 1,200,000' : 'e.g. 150,000'} aria-describedby="hero-budget-hint" />
      {showPeriod ? <span className="mini-toggle" role="group" aria-label="Rent period">
        <button type="button" className={filters.budgetPeriod === 'month' ? 'selected' : ''} aria-pressed={filters.budgetPeriod === 'month'} onClick={() => update({ budgetPeriod: 'month' })}>Month</button>
        <button type="button" className={filters.budgetPeriod === 'year' ? 'selected' : ''} aria-pressed={filters.budgetPeriod === 'year'} onClick={() => update({ budgetPeriod: 'year' })}>Year</button>
      </span> : null}
    </label>
    <button className="primary">Search homes</button>
    <small id="hero-budget-hint" className="search-hint">{budgetHint(filters.type, filters.budgetPeriod)}. Type the full amount in FCFA.</small>
  </form>
}

function Home({ listings: homeListings, filters, update, search, onOpen, savedIds, onSave, go, navigate }) {
  const live = homeListings.filter(isAvailable)
  const featured = sortListings(live.filter((item) => item.featured || !item.sample), 'recommended').slice(0, 4)
  return <>
    <section className="hero"><div className="shell hero-grid"><div className="hero-copy">
      <h1>Find Verified Properties.<br />Move in with <em>Confidence.</em></h1><p>Findam connects house seekers, landlords, civil engineers and agents on one trusted platform.</p>
      <div className="type-tabs" role="group" aria-label="What are you looking for?">
        <button type="button" className={!filters.type ? 'selected' : ''} aria-pressed={!filters.type} onClick={() => update({ type: '' })}>All</button>
        <button type="button" className={filters.type === 'Rent' ? 'selected' : ''} aria-pressed={filters.type === 'Rent'} onClick={() => update({ type: 'Rent' })}>For Rent</button>
        <button type="button" className={filters.type === 'Sale' ? 'selected' : ''} aria-pressed={filters.type === 'Sale'} onClick={() => update({ type: 'Sale' })}>For Sale</button>
        <button type="button" className={filters.type === 'Guest house' ? 'selected' : ''} aria-pressed={filters.type === 'Guest house'} onClick={() => update({ type: 'Guest house' })}>Guest house</button>
      </div>
      <HeroSearch filters={filters} update={update} search={search} />
      <div className="trust-strip"><Trust icon="✓" title="Accepted listings" text="Public only after an admin accepts" /><Trust icon="⌖" title="City coverage" text="Bamenda, Buea and Yaounde" /><Trust icon="★" title="Referral programme" text="Refer a landlord and gain" /><Trust icon="🔔" title="Home alerts" text="Be told when a match appears" /></div>
    </div><div className="hero-visual"><div className="hero-photo" /><div className="verified-float">✓ <span>Agent visited<br />Engineer reviewed</span></div></div></div></section>
    <section className="shell featured section"><div className="section-head"><h2>Featured listings</h2><Link to="/homes" navigate={navigate} className="text-button">View all listings →</Link></div><div className="cards">{featured.map((item) => <ListingCard key={item.id} listing={item} onOpen={onOpen} saved={savedIds.includes(item.id)} onSave={onSave} />)}</div></section>
    <section className="shell section city-section"><div className="section-head"><h2>Browse by city</h2></div><div className="city-grid">{cities.map((city) => {
      const count = live.filter((item) => item.city === city).length
      return <Link key={city} to={homesLink({ city })} navigate={navigate} className="city-card"><b>{city}</b><span>{count} {count === 1 ? 'home' : 'homes'} available</span><span className="city-links"><span>Rent</span><span>Sale</span><span>Guest houses</span></span></Link>
    })}</div></section>
    <section className="shell role-section"><Role icon="⌂" title="I'm a Landlord" text="List your property and get serious tenants faster." action="List Property" onClick={() => go('list')} /><Role icon="⌕" title="I'm a House Seeker" text="Find verified properties that match your needs." action="Start Searching" onClick={() => go('listings')} /><Role icon="♙" title="I know a landlord" text="Refer them to Findam and gain when their homes are let." action="Refer a landlord" onClick={() => go('refer')} /></section>
    <section className="workflow-preview"><div className="shell"><p className="kicker">HOW FINDAM WORKS</p><h2>Verified from visit to move-in.</h2><div className="steps"><Step number="1" title="Search" text="Filter by city, budget, bedrooms and type." /><Step number="2" title="Browse accepted homes" text="Only homes an admin has accepted appear publicly. Sample cards are marked." /><Step number="3" title="Unlock the contact" text="One access pass unlocks the landlord’s phone and exact location of 4 homes you choose, for 48 hours." /><Step number="4" title="Schedule viewing" text="Choose a time to see the home." /><Step number="5" title="Move in" text="Your agent supports the handover." /></div><p className="workflow-more"><Link to="/how-it-works" navigate={navigate} className="text-button">Read how Findam verifies homes →</Link></p></div></section>
  </>
}

function Trust({ icon, title, text }) { return <div className="trust"><i aria-hidden="true">{icon}</i><span><b>{title}</b><small>{text}</small></span></div> }
function Role({ icon, title, text, action, onClick }) { return <article className="role"><i aria-hidden="true">{icon}</i><div><h3>{title}</h3><p>{text}</p><button onClick={onClick}>{action} →</button></div></article> }
function Step({ number, title, text }) { return <article><b>{number}</b><h3>{title}</h3><p>{text}</p></article> }

function Detail({ listing, loaded, all, back, member, go, navigate, onOpen, savedIds, onSave, passInfo, passLeft, onUnlock, onPassChange }) {
  const [details, setDetails] = useState(null)
  const [detailsError, setDetailsError] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const active = passLeft ? passInfo?.active : null
  const homeUnlocked = Boolean(listing && active?.homes?.includes(String(listing.id)))
  const unlocked = Boolean(member && listing && (passInfo?.admin || listing.sample || homeUnlocked))
  const slotsLeft = active?.slotsLeft || 0
  useEffect(() => { setShowMap(false) }, [listing?.id])
  // Contact and exact location come from the server only while the access pass is active.
  useEffect(() => {
    setDetails(null)
    setDetailsError('')
    if (!listing || !unlocked) return undefined
    let ignore = false
    fetch(`/api/listings/${encodeURIComponent(listing.id)}/details`, { headers: authHeadersFor(member) })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (ignore) return
        if (response.ok) setDetails(payload)
        else if (response.status !== 402) setDetailsError(payload.error || 'The details could not be loaded.')
      })
      .catch(() => { if (!ignore) setDetailsError('The details could not be loaded. Check your connection.') })
    return () => { ignore = true }
  }, [listing?.id, unlocked, member?.token])
  if (!listing && !loaded) return <section className="shell section"><p role="status" className="muted">Loading this home…</p></section>
  if (!listing) return <section className="shell section"><div className="empty"><h1 className="empty-title">This home is no longer listed</h1><p>It may have been taken or removed.</p><Link to="/homes" navigate={navigate} className="primary">Browse homes</Link></div></section>
  const available = isAvailable(listing)
  const badge = statusBadge(listing)
  const similar = all.filter((item) => item.id !== listing.id && item.city === listing.city && isAvailable(item)).slice(0, 4)
  const photos = listing.photos || []
  const unlock = () => { if (!member) go('account'); else onUnlock() }
  const fee = formatFcfa(passInfo?.fee || 10000)
  const hours = passInfo?.hours || 48
  const homesPerPass = passInfo?.homes || 4
  const useSlot = async () => {
    setUnlocking(true)
    setDetailsError('')
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(listing.id)}/unlock`, { method: 'POST', headers: authHeadersFor(member) })
      const payload = await response.json().catch(() => ({}))
      if (payload.active !== undefined) onPassChange(payload.active)
      if (!response.ok) throw new Error(payload.error || 'This home could not be unlocked.')
      setDetails(payload)
    } catch (error) {
      setDetailsError(error.message)
    } finally {
      setUnlocking(false)
    }
  }
  return <section className="shell section">
    <div className="breadcrumbs" role="navigation" aria-label="Breadcrumb"><ol>
      <li><Link to="/" navigate={navigate}>Home</Link></li>
      <li><Link to={homesLink({ city: listing.city })} navigate={navigate}>Homes in {listing.city}</Link></li>
      <li><Link to={homesLink({ city: listing.city, type: listing.type })} navigate={navigate}>{listing.type === 'Guest house' ? 'Guest houses' : listing.type === 'Sale' ? 'For sale' : 'For rent'}</Link></li>
      <li aria-current="page">{listing.title}</li>
    </ol></div>
    <button className="text-button back" onClick={back}>← Back to results</button>
    <div className="detail"><div>
      <Gallery photos={photos} thumbs={listing.thumbs || []} title={listing.title} hue={listing.hue} taken={!available} overlay={<>
        <span className={`badge ${badge.tone}`}>{badge.text}</span>
        <button type="button" className={`heart ${savedIds.includes(listing.id) ? 'saved' : ''}`} onClick={() => onSave(listing.id)} aria-label={savedIds.includes(listing.id) ? 'Remove from saved' : 'Save property'} aria-pressed={savedIds.includes(listing.id)}>{savedIds.includes(listing.id) ? '♥' : '♡'}</button>
      </>} />
      <p className="kicker">{listing.type} · {listing.neighbourhood}, {listing.city}</p>
      <h1 className="page-title">{listing.title}</h1>
      <p className="lead">{listing.description}</p>
      <div className="facts">{listing.beds ? <span>{listing.beds} {listing.beds === 1 ? 'Bedroom' : 'Bedrooms'}</span> : null}{listing.baths ? <span>{listing.baths} {listing.baths === 1 ? 'Bathroom' : 'Bathrooms'}</span> : null}{listing.size ? <span>{listing.size} m²</span> : null}<span>{PERIODS[listing.period]?.long === 'sale price' ? 'For sale' : `Paid ${PERIODS[listing.period]?.long || ''}`}</span></div>
      <div className={`location-block${unlocked ? '' : ' locked'}`}>
        <div><h2>{unlocked ? 'Location' : '🔒 Location'}</h2><p>{!unlocked
          ? <>{listing.neighbourhood}, {listing.city}. {listing.exact ? 'The exact position of the house and directions to it unlock' : 'The map unlocks'} {slotsLeft ? 'when you unlock this home.' : 'with an access pass.'}</>
          : listing.exact ? <>{listing.neighbourhood}, {listing.city}. The pin marks the house itself, and you can get directions from where you are.</>
            : <>{listing.neighbourhood}, {listing.city}. The map shows the neighbourhood; the house finder will guide you to the door.</>}</p></div>
        {unlocked
          ? <button type="button" className="secondary" aria-expanded={showMap} onClick={() => setShowMap(!showMap)} disabled={listing.exact && !details}>{showMap ? 'Hide map' : 'See location'}</button>
          : <button type="button" className="primary" onClick={slotsLeft ? useSlot : unlock} disabled={unlocking}>{!member ? 'Sign in to unlock' : slotsLeft ? 'Unlock this home' : 'Unlock location'}</button>}
      </div>
      {unlocked && showMap ? (listing.exact && details?.exact
        ? <Suspense fallback={<p className="muted" role="status">Loading the map…</p>}><ExactMap lat={details.lat} lng={details.lng} title={listing.title} /></Suspense>
        : <SearchMap compact city={listing.city} query={listing.neighbourhood} listings={[listing]} />) : null}
    </div><aside>
      <p className="kicker">PRICE</p>
      <h2 className="detail-price">{formatFcfa(listing.price)}</h2>
      <p className="price-period">{listing.period === 'sale' ? 'Full sale price' : PERIODS[listing.period]?.long}</p>
      {listing.period === 'year' ? <p className="price-note">About {formatFcfa(listing.price / 12)} a month</p> : null}
      {!available ? <div className="taken-note"><b>This home has been taken.</b><p>It is no longer available, so its contact is closed.</p><Link to={homesLink({ city: listing.city, type: listing.type })} navigate={navigate} className="primary">See similar homes</Link></div>
        : unlocked ? <div className="contact-box unlocked">
          {details ? (details.phone
            ? <><span className="contact-label">Landlord’s phone</span><a className="contact-phone" href={`tel:${details.phone.replace(/\s/g, '')}`}>{details.phone}</a><a className="secondary contact-call" href={`tel:${details.phone.replace(/\s/g, '')}`}>Call now</a></>
            : <p>This is a sample home, so there is no real contact. Real listings show the landlord’s phone here.</p>)
            : detailsError ? <p className="form-message warn">{detailsError}</p> : <p className="muted">Loading the contact…</p>}
          {passInfo?.admin ? <small className="pass-left">Admin access</small> : listing.sample ? null : details?.expiresAt ? <small className="pass-left">Unlocked until {new Date(details.expiresAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ({passLeft} left)</small> : null}
        </div>
        : slotsLeft ? <div className="locked-card ready">
          <b>🔓 You can unlock this home</b>
          <p>You have <b>{slotsLeft} of {active.maxHomes}</b> {active.maxHomes === 1 ? 'home' : 'homes'} left on your pass. Unlocking shows the landlord’s phone number and the exact location until your pass ends ({passLeft} left).</p>
          <button className="primary" onClick={useSlot} disabled={unlocking}>{unlocking ? 'Unlocking…' : 'Unlock this home'}</button>
          {detailsError ? <p className="form-message warn">{detailsError}</p> : null}
        </div>
        : <div className="locked-card">
          <b>🔒 Contact and exact location are locked</b>
          <p>{active ? `You have used all ${active.maxHomes} homes on your pass.` : `Choose up to ${homesPerPass} homes you like best and see each landlord’s phone number and the exact location for ${hours} hours.`}</p>
          <button className="primary" onClick={unlock}>{!member ? 'Sign in to unlock' : active ? `Get a new pass · ${fee}` : `Get a pass · ${fee}`}</button>
          <small>{member ? `${homesPerPass} homes · ${hours} hours · MTN or Orange Money` : 'Creating an account is free and takes under a minute.'}</small>
        </div>}
      {listing.sample ? <div className="verified">Sample listing. A house finder has not inspected this home.</div> : <div className="verified">Accepted by an admin and visible to house seekers.</div>}
    </aside></div>
    {similar.length ? <section className="similar"><div className="section-head"><h2>More homes in {listing.city}</h2><Link to={homesLink({ city: listing.city })} navigate={navigate} className="text-button">See all in {listing.city} →</Link></div><div className="cards">{similar.map((item) => <ListingCard key={item.id} listing={item} onOpen={onOpen} saved={savedIds.includes(item.id)} onSave={onSave} />)}</div></section> : null}
  </section>
}

function Agents({ navigate }) { return <section className="shell section"><p className="kicker">HOUSE FINDERS</p><h1 className="page-title">Findam in each city</h1><p className="lead">Viewings are arranged from a listing after you open the contact. These desks are coverage areas, not named staff.</p><div className="agent-grid">{desks.map((desk) => <article className="agent" key={desk.city}><div className="avatar">{desk.initials}</div><h3>Findam {desk.city}</h3><p>{desk.text}</p><Link to={homesLink({ city: desk.city })} navigate={navigate} className="secondary">Browse homes in {desk.city}</Link></article>)}</div></section> }

function ListProperty({ member, go, onMember, isAdmin }) {
  const [sent, setSent] = useState(false)
  const [city, setCity] = useState('')
  const [type, setType] = useState('Rent')
  const [period, setPeriod] = useState('month')
  const [price, setPrice] = useState(null)
  const [photos, setPhotos] = useState([])
  const [photoNote, setPhotoNote] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [exact, setExact] = useState(null)
  const allowedPhotos = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  const priceLabel = type === 'Sale' ? 'Sale price (FCFA)' : type === 'Guest house' ? 'Price per night (FCFA)' : period === 'year' ? 'Rent per year (FCFA)' : 'Rent per month (FCFA)'
  const addPhotos = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, 6)
    setPreparing(true)
    const accepted = []
    const rejected = []
    for (const original of files) {
      if (!allowedPhotos.has(original.type)) { rejected.push(original.name); continue }
      const { full, thumb } = await preparePhoto(original)
      if (full.size > 5 * 1024 * 1024) rejected.push(original.name); else accepted.push({ file: full, thumb })
    }
    setPhotos((current) => { current.forEach((item) => URL.revokeObjectURL(item.url)); return accepted.map((item) => ({ name: item.file.name, url: URL.createObjectURL(item.file), file: item.file, thumb: item.thumb })) })
    setPhotoNote(rejected.length ? 'Some files were skipped. Use JPEG, PNG, WEBP or GIF photos.' : '')
    setPreparing(false)
  }
  const submit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!price || price < 500) { setSubmitError('Enter the full price in FCFA, for example 150,000.'); return }
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
      body.set('price', String(price))
      body.set('priceUnit', 'fcfa')
      body.set('period', type === 'Rent' ? period : '')
      photos.forEach((item, index) => {
        body.append('photos', item.file)
        if (item.thumb) body.append(`thumb_${index}`, item.thumb)
      })
      if (isAdmin && exact) { body.set('exactLat', String(exact.lat)); body.set('exactLng', String(exact.lng)) }
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
  if (!member) return <section className="shell section"><div className="form-wrap"><p className="kicker">LANDLORD PORTAL</p><h1 className="page-title">List your property</h1><p className="lead">Create a free account or sign in before sending a property. An admin reviews it, and it stays off the public site until it is accepted.</p><button className="primary" onClick={() => go('account')}>Create an account or sign in</button></div></section>
  return <section className="shell section"><div className="form-wrap">
    {sent ? <Modal title="Sent for review" onClose={() => setSent(false)} actions={<><button className="primary" autoFocus onClick={() => go(isAdmin ? 'admin' : 'account')}>{isAdmin ? 'Review it now' : 'Go to my listings'}</button><button className="secondary" onClick={() => { setSent(false); setPrice(null); setPhotos([]); setExact(null) }}>List another</button></>}><p>Thank you. An admin will check your property. It appears publicly once it is accepted, and you can mark it as taken from your account when it is rented or sold.</p></Modal> : null}
    <p className="kicker">LANDLORD PORTAL</p><h1 className="page-title">List your property</h1><p className="lead">Submit your details and photos. An admin reviews the property before it appears publicly.</p>
    <form className="property-form" onSubmit={submit}>
      <label className="span-2">Property title<input name="title" required maxLength="120" placeholder="e.g. 2 Bedroom Apartment" /></label>
      <label>City<select name="city" required value={city} onChange={(event) => setCity(event.target.value)}><option value="">Choose a city</option>{cities.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Neighbourhood<input name="neighbourhood" required maxLength="80" placeholder="e.g. Molyko" /></label>
      <label>Property type<select name="type" value={type} onChange={(event) => setType(event.target.value)}><option>Rent</option><option>Sale</option><option>Guest house</option></select></label>
      {type === 'Rent' ? <label>Rent is paid<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="month">Every month</option><option value="year">Every year</option></select></label> : <span className="form-spacer" />}
      <label className="span-2">{priceLabel}
        <PriceInput required value={price} onChange={setPrice} placeholder={type === 'Sale' ? 'e.g. 25,000,000' : type === 'Guest house' ? 'e.g. 25,000' : period === 'year' ? 'e.g. 1,200,000' : 'e.g. 150,000'} />
        <small>Type the full amount, not thousands. {price ? <b>Shown to house seekers as {priceLine({ price, period: type === 'Sale' ? 'sale' : type === 'Guest house' ? 'night' : period })}</b> : 'For 150,000 FCFA, type 150000.'}</small>
      </label>
      <div className="trio span-2">
        <label>Bedrooms<input name="beds" type="number" inputMode="numeric" min="0" max="50" placeholder="e.g. 2" /></label>
        <label>Bathrooms<input name="baths" type="number" inputMode="numeric" min="0" max="50" placeholder="e.g. 1" /></label>
        <label>Size (m², optional)<input name="size" type="number" inputMode="numeric" min="1" max="100000" placeholder="e.g. 80" /></label>
      </div>
      <label className="span-2">Description (optional)<textarea name="description" maxLength="600" placeholder="Water, light, parking, distance to the main road, who it suits…" /></label>
      <label className="span-2">Phone number<input name="phone" required type="tel" inputMode="tel" placeholder="+237 6XX XXX XXX" /><small>Only shown to members who open the contact.</small></label>
      <label className="photo-upload">Property photos<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={addPhotos} /><span>{preparing ? 'Preparing your photos…' : 'Upload up to 6 photos. They are shown whole, exactly as you took them, upright or sideways.'}</span></label>
      {photoNote && <p className="form-message warn span-2">{photoNote}</p>}
      {photos.length > 0 && <div className="photo-previews">{photos.map((item) => <span className="preview" key={item.url}><img src={item.url} alt={item.name} /></span>)}</div>}
      {isAdmin ? <div className="admin-pin span-2">
        <h2>Exact location <span>Admin only</span></h2>
        <p>Pin the house so visitors see exactly where it is. Visitors only see a pin on the map.</p>
        <Suspense fallback={<p className="muted">Loading the map…</p>}><LocationPicker value={exact} onChange={setExact} city={city} /></Suspense>
      </div> : null}
      {submitError && <p className="form-message warn span-2" role="alert">{submitError}</p>}
      <button className="primary span-2" disabled={saving || preparing}>{saving ? 'Saving…' : 'Submit for review'}</button>
    </form>
  </div></section>
}

function Workflow({ go }) { return <section className="shell section"><p className="kicker">THE FINDAM WORKFLOW</p><h1 className="page-title">One trusted workflow for every listing.</h1><div className="workflow-grid"><article><span>01</span><h2>Landlord submits</h2><p>Sign in and send the property details, photos and the full price in FCFA.</p></article><article><span>02</span><h2>Admin reviews</h2><p>The listing stays off the public site until an admin accepts it.</p></article><article><span>03</span><h2>Published</h2><p>The accepted property becomes visible, and members with matching alerts are notified.</p></article><article><span>04</span><h2>Viewing</h2><p>A signed-in member opens the contact, and a house finder arranges the visit. Once taken, the home is marked unavailable.</p></article></div><div className="bot-callout"><div><p className="kicker">FINDAM BOT</p><h2>Ask on this site.</h2><p>Search properties or list a home from the site. A WhatsApp line will be added when Findam publishes its own number.</p></div></div><button className="primary" onClick={() => go('list')}>List a property</button></section> }

function Saved({ listings, onOpen, savedIds, onSave, go }) { return <section className="shell section"><p className="kicker">YOUR SHORTLIST</p><h1 className="page-title">Saved properties</h1>{listings.length ? <div className="cards saved-grid">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} onOpen={onOpen} saved={savedIds.includes(listing.id)} onSave={onSave} />)}</div> : <div className="empty"><h2>No saved homes yet</h2><p>Tap the heart on any home to keep it here.</p><button className="primary" onClick={() => go('listings')}>Browse verified listings</button></div>}</section> }

function HelpBot({ go, navigate, passInfo }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([{ from: 'bot', text: 'Hi! I am Findam Bot. Ask me about homes, prices, the access pass, paying with MTN or Orange Money, listing a property or the referral programme.' }])
  const botReply = (text) => answer(text, { fee: passInfo?.fee, hours: passInfo?.hours, homes: passInfo?.homes }).text
  const sendMessage = (event) => { event.preventDefault(); const text = message.trim(); if (!text) return; setMessages((current) => [...current, { from: 'user', text }, { from: 'bot', text: botReply(text) }]); setMessage('') }
  const quickReply = (text) => setMessages((current) => [...current, { from: 'user', text }, { from: 'bot', text: botReply(text) }])
  return <div className="bot-widget">
    {open && <section className="bot-panel" aria-label="Findam Bot"><header><span className="bot-logo" aria-hidden="true">🤖</span><div><b>Findam Bot</b><small>Online · replies instantly</small></div><button onClick={() => setOpen(false)} aria-label="Close help">×</button></header><div className="bot-chat" aria-live="polite">{messages.map((item, index) => <p className={item.from} key={`${item.from}-${index}`}>{item.text}</p>)}</div><form className="bot-input" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type your message..." aria-label="Message Findam Bot" /><button type="submit" aria-label="Send message">➤</button></form><div className="bot-actions"><button onClick={() => quickReply('How much is the access pass?')}>Access pass</button><button onClick={() => quickReply('How do I pay?')}>Payments</button><button onClick={() => quickReply('How does the referral programme work?')}>Referrals</button><button onClick={() => { navigate(homesLink({ type: 'Rent' })); setOpen(false) }}>Find a home</button><button onClick={() => { go('list'); setOpen(false) }}>List a property</button></div></section>}
    <button className="whatsapp" onClick={() => setOpen(!open)} aria-label={open ? 'Close Findam Bot' : 'Open Findam Bot'} aria-expanded={open}><span className="floating-bot" aria-hidden="true">🤖</span><span>Findam Bot</span></button>
  </div>
}

export default App
