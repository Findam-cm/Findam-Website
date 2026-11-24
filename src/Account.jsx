import { useEffect, useState } from 'react'
import { authClient } from './auth.js'
import { authHeadersFor } from './Refer.jsx'
import { Modal, PasswordInput } from './ui.jsx'
import { priceLine } from './price.js'

function initialMode() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('token')) return 'reset'
  if (params.get('error') === 'INVALID_TOKEN') return 'forgot'
  if (params.get('mode') === 'signin') return 'signin'
  return 'signup'
}

const TITLES = {
  signup: ['Create your Findam account', 'Free to join. See landlord contacts, save homes, get alerts when new homes match your search, list a property and refer landlords.'],
  signin: ['Welcome back', 'Sign in to see your saved homes, alerts, listings and referrals.'],
  forgot: ['Reset your password', 'Enter the email on your account. We will send a link to choose a new password.'],
  reset: ['Choose a new password', 'Enter a new password for your account.'],
}

function friendlyError(error, mode) {
  const text = String(error?.message || error?.statusText || '')
  if (/already exists|already registered|in use/i.test(text)) return 'This email already has an account. Use Sign in instead.'
  if (/invalid (email or )?password|invalid credentials|incorrect/i.test(text)) return 'That email and password do not match. Check them, or reset your password.'
  if (/password.*(short|least)/i.test(text)) return 'Use a password of at least 8 characters.'
  if (/too many/i.test(text)) return 'Too many attempts. Wait a minute, then try again.'
  return text || (mode === 'signup' ? 'Your account could not be created. Try again.' : 'Sign in failed. Try again.')
}

export default function Account({ member, onMember, referralCount, savedCount, alertCount, go }) {
  const [loading, setLoading] = useState(true)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '')
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [message, setMessage] = useState(() => new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN' ? 'This reset link has expired. Request a new one.' : '')
  const [busy, setBusy] = useState(false)
  const [welcome, setWelcome] = useState(null)

  useEffect(() => {
    let ignore = false
    authClient.getSession().then((result) => {
      if (ignore) return
      const session = result.data?.session
      const user = result.data?.user
      if (session?.token && user) onMember?.({ token: session.token, email: user.email, name: user.name })
      setLoading(false)
    }).catch(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [])

  const switchMode = (next) => { setMode(next); setMessage(''); setPassword(''); setConfirm('') }

  const submit = async (event) => {
    event.preventDefault()
    if (mode === 'signup' && password !== confirm) { setMessage('The two passwords do not match.'); return }
    setBusy(true)
    setMessage('')
    try {
      const cleanName = name.trim()
      const result = mode === 'signup'
        ? await authClient.signUp.email({ name: cleanName || email.split('@')[0] || 'Member', email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password })
      if (result?.error) throw result.error
      const sessionResult = await authClient.getSession()
      const session = sessionResult.data?.session
      const user = sessionResult.data?.user
      setPassword('')
      setConfirm('')
      if (session?.token && user) {
        onMember?.({ token: session.token, email: user.email, name: user.name })
        if (mode === 'signup') setWelcome({ name: user.name || cleanName, email: user.email, signedIn: true })
      } else if (mode === 'signup') {
        setWelcome({ name: cleanName, email: email.trim(), signedIn: false })
        setMode('signin')
      } else {
        setMessage('Signed in, but the session could not be read. Reload the page.')
      }
    } catch (error) {
      setMessage(friendlyError(error, mode))
    } finally {
      setBusy(false)
    }
  }

  const requestReset = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/account` })
      if (result?.error) throw result.error
      setMessage('If that email has an account, we sent a reset link. Open it to choose a new password.')
    } catch (error) {
      setMessage(error?.message || 'The reset email could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  const savePassword = async (event) => {
    event.preventDefault()
    if (password !== confirm) { setMessage('The two passwords do not match.'); return }
    setBusy(true)
    setMessage('')
    try {
      const result = await authClient.resetPassword({ newPassword: password, token: resetToken })
      if (result?.error) throw result.error
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      url.searchParams.delete('error')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
      setResetToken('')
      switchMode('signin')
      setMessage('Password updated. Sign in with your new password.')
    } catch (error) {
      const text = error?.message || 'The reset link could not be used.'
      setMessage(/token/i.test(text) ? 'This reset link has expired. Request a new one.' : text)
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await authClient.signOut().catch(() => {})
    onMember?.(null)
    switchMode('signin')
  }

  const welcomeModal = welcome ? <Modal
    title={welcome.signedIn ? 'Your account has been created' : 'Account created'}
    onClose={() => setWelcome(null)}
    actions={welcome.signedIn
      ? <><button className="primary" autoFocus onClick={() => { setWelcome(null); go('listings') }}>Browse homes</button><button className="secondary" onClick={() => setWelcome(null)}>Go to my account</button></>
      : <button className="primary" autoFocus onClick={() => setWelcome(null)}>Sign in now</button>}
  >
    <p>{welcome.signedIn ? <>Welcome to Findam{welcome.name ? `, ${welcome.name}` : ''}! You are signed in as <b>{welcome.email}</b>.</> : <>We saved your account for <b>{welcome.email}</b>. Sign in with the password you just chose.</>}</p>
  </Modal> : null

  if (loading) return <section className="shell section narrow"><p role="status">Checking your session…</p></section>

  if (member && mode !== 'reset') return <section className="shell section">
    {welcomeModal}
    <p className="kicker">YOUR ACCOUNT</p>
    <div className="profile-card">
      <div className="profile-avatar" aria-hidden="true">{(member.name || member.email || '?').trim().charAt(0).toUpperCase()}</div>
      <div><h1>{member.name || 'Findam member'}</h1><p>{member.email}</p></div>
      <button className="secondary" onClick={signOut}>Sign out</button>
    </div>
    <div className="stat-grid">
      <button type="button" className="stat" onClick={() => go('refer')}><strong>{referralCount ?? 0}</strong><span>Landlords referred</span><small>Referral programme</small></button>
      <button type="button" className="stat" onClick={() => go('saved')}><strong>{savedCount}</strong><span>Saved homes</span><small>Your shortlist</small></button>
      <button type="button" className="stat" onClick={() => go('alerts')}><strong>{alertCount}</strong><span>Home alerts</span><small>New matches are announced</small></button>
    </div>
    <MyListings member={member} go={go} />
  </section>

  const [title, lead] = TITLES[mode]
  return <section className="shell section narrow">
    {welcomeModal}
    <p className="kicker">YOUR ACCOUNT</p>
    <h1 className="page-title">{title}</h1>
    <p className="lead">{lead}</p>
    {mode === 'signup' || mode === 'signin' ? <div className="auth-tabs" role="tablist" aria-label="Account">
      <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'selected' : ''} onClick={() => switchMode('signup')}>Create account</button>
      <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'selected' : ''} onClick={() => switchMode('signin')}>Sign in</button>
    </div> : null}

    {mode === 'reset' ? <form className="auth-form" onSubmit={savePassword}>
      <label htmlFor="account-new-password">New password</label>
      <PasswordInput id="account-new-password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
      <label htmlFor="account-confirm-password">Confirm new password</label>
      <PasswordInput id="account-confirm-password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} shown={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} />
      <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Save new password'}</button>
      <button type="button" className="text-button" onClick={() => switchMode('forgot')}>Request a new link</button>
      {message ? <p className="form-message" role="alert">{message}</p> : null}
    </form> : mode === 'forgot' ? <form className="auth-form" onSubmit={requestReset}>
      <label htmlFor="account-reset-email">Email</label>
      <input id="account-reset-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</button>
      <button type="button" className="text-button" onClick={() => switchMode('signin')}>Back to sign in</button>
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </form> : <form className="auth-form" onSubmit={submit} noValidate={false}>
      {mode === 'signup' ? <><label htmlFor="account-name">Full name</label><input id="account-name" autoComplete="name" required minLength="2" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Kum Terence" /></> : null}
      <label htmlFor="account-email">Email</label>
      <input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      <label htmlFor="account-password">Password</label>
      <PasswordInput id="account-password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
      {mode === 'signup' ? <>
        <small className={`field-hint${password && password.length < 8 ? ' warn' : ''}`}>{password.length >= 8 ? '✓ At least 8 characters' : 'Use at least 8 characters'}</small>
        <label htmlFor="account-confirm">Confirm password</label>
        <PasswordInput id="account-confirm" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} shown={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} />
        {confirm ? <small className={`field-hint${confirm === password ? '' : ' warn'}`}>{confirm === password ? '✓ Passwords match' : 'Passwords do not match yet'}</small> : null}
      </> : null}
      <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create my account' : 'Sign in'}</button>
      {mode === 'signin' ? <button type="button" className="text-button" onClick={() => switchMode('forgot')}>Forgot your password?</button> : null}
      <p className="auth-switch">{mode === 'signup' ? <>Already have an account? <button type="button" className="text-button" onClick={() => switchMode('signin')}>Sign in</button></> : <>New to Findam? <button type="button" className="text-button" onClick={() => switchMode('signup')}>Create an account</button></>}</p>
      {message ? <p className="form-message" role="alert">{message}</p> : null}
    </form>}
  </section>
}

function MyListings({ member, go }) {
  const [listings, setListings] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = () => fetch('/api/my/listings', { headers: authHeadersFor(member) })
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((payload) => setListings(payload.listings || []))
    .catch(() => setListings([]))

  useEffect(() => { load() }, [member?.token])

  const toggle = async (item) => {
    setBusy(item.id)
    setError('')
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(item.id)}/availability`, { method: 'POST', headers: authHeadersFor(member), body: JSON.stringify({ available: !item.available }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'The listing could not be updated.')
      await load()
    } catch (toggleError) {
      setError(toggleError.message)
    } finally {
      setBusy('')
    }
  }

  return <div className="my-listings">
    <div className="section-head"><h2>Your listings</h2><button className="primary" onClick={() => go('list')}>List a property</button></div>
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {listings === null ? <p role="status">Loading your listings…</p> : listings.length ? <ul className="owner-list">{listings.map((item) => <li key={item.id}>
      <div><b>{item.title}</b><small>{item.neighbourhood}, {item.city} · {priceLine(item)}</small></div>
      <span className={`status-pill ${item.status === 'published' ? (item.available ? 'live' : 'taken') : item.status}`}>{item.status === 'published' ? (item.available ? 'Live' : 'Taken') : item.status === 'pending' ? 'Waiting for review' : 'Declined'}</span>
      {item.status === 'published' ? <button type="button" className="secondary" disabled={busy === item.id} onClick={() => toggle(item)}>{busy === item.id ? 'Saving…' : item.available ? 'Mark as taken' : 'Mark as available'}</button> : null}
    </li>)}</ul> : <p className="muted">You have not listed a property yet. When your home is rented or sold, mark it as taken here so house seekers stop calling.</p>}
  </div>
}
