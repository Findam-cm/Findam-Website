import { useEffect, useState } from 'react'
import { createRealtimeClient } from '@neon/realtime/client'
import { authClient } from './auth.js'

export default function Account({ member, onMember }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '')
  const [mode, setMode] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('token')) return 'reset'
    if (params.get('error') === 'INVALID_TOKEN') return 'forgot'
    return 'signup'
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState(() => new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN' ? 'This reset link has expired. Request a new one.' : '')
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState([])
  const [liveStatus, setLiveStatus] = useState('connecting')
  const [note, setNote] = useState('')

  useEffect(() => {
    let ignore = false
    authClient.getSession().then((result) => {
      if (ignore) return
      if (result.data?.session && result.data?.user) {
        setSession(result.data.session)
        setUser(result.data.user)
        onMember?.(result.data.session.token ? { token: result.data.session.token, email: result.data.user.email, name: result.data.user.name } : null)
      }
      setLoading(false)
    }).catch(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    const url = import.meta.env.VITE_NEON_REALTIME_URL
    if (!url || !member?.token) {
      setLiveStatus(member?.token ? 'connecting' : 'signed-out')
      setNotes([])
      return undefined
    }
    let stop = () => {}
    let client
    let ignore = false
    fetch('/api/realtime/activity', {
      method: 'POST',
      credentials: 'include',
      headers: { authorization: `Bearer ${member.token}` },
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((sealed) => {
        if (ignore) return
        client = createRealtimeClient({ url })
        const subscription = client.subscribe(sealed)
        stop = subscription.onChange(({ data, status, error }) => {
          if (error) {
            setLiveStatus('unavailable')
            return
          }
          setLiveStatus(status || 'live')
          if (Array.isArray(data)) setNotes(data)
        })
      })
      .catch(() => { if (!ignore) setLiveStatus('unavailable') })
    return () => {
      ignore = true
      stop()
      client?.close()
    }
  }, [member?.token])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const result = mode === 'signup'
        ? await authClient.signUp.email({ name: name.trim() || email.split('@')[0] || 'Member', email, password })
        : await authClient.signIn.email({ email, password })
      if (result?.error) throw result.error
      const sessionResult = await authClient.getSession()
      if (sessionResult.data?.session && sessionResult.data?.user) {
        setSession(sessionResult.data.session)
        setUser(sessionResult.data.user)
        onMember?.(sessionResult.data.session.token ? { token: sessionResult.data.session.token, email: sessionResult.data.user.email, name: sessionResult.data.user.name } : null)
        setPassword('')
      } else {
        setMessage('Account saved. Check your email if a confirmation is required, then sign in.')
      }
    } catch (error) {
      const text = error?.message || 'The account request was rejected.'
      setMessage(/already exists/i.test(text) ? 'This email already has an account. Choose Sign in below.' : text)
    } finally {
      setBusy(false)
    }
  }

  const requestReset = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/account`,
      })
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
    if (nextPassword !== confirmPassword) {
      setMessage('The two passwords do not match.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await authClient.resetPassword({ newPassword: nextPassword, token: resetToken })
      if (result?.error) throw result.error
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      url.searchParams.delete('error')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
      setResetToken('')
      setMode('signin')
      setPassword('')
      setNextPassword('')
      setConfirmPassword('')
      setMessage('Password updated. Sign in with your new password.')
    } catch (error) {
      const text = error?.message || 'The reset link could not be used.'
      setMessage(/token/i.test(text) ? 'This reset link has expired. Request a new one.' : text)
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await authClient.signOut()
    setSession(null)
    setUser(null)
    onMember?.(null)
  }

  const saveNote = async (event) => {
    event.preventDefault()
    const text = note.trim()
    if (text.length < 2 || !member?.token) return
    setNote('')
    await fetch('/api/activity', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${member.token}` },
      body: JSON.stringify({ note: text }),
    })
  }

  return <section className="shell section">
    <p className="kicker">YOUR ACCOUNT</p>
    <h1 className="page-title">{mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Sign in to Findam'}</h1>
    <p className="lead">{mode === 'forgot' ? 'Enter the email on your account. We will send a link to choose a new password.' : mode === 'reset' ? 'Enter a new password for your account.' : 'Save a shortlist, list a property, and follow new notes as they are saved.'}</p>
    {loading ? <p>Checking your session…</p> : session && user && mode !== 'reset' ? (
      <div className="success"><p>Signed in as {user.email}</p><button className="secondary" onClick={signOut}>Sign out</button></div>
    ) : mode === 'reset' ? (
      <form className="property-form account-form stack" onSubmit={savePassword}>
        <label>New password<input id="account-new-password" type="password" autoComplete="new-password" required minLength="8" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label>
        <label>Confirm password<input id="account-confirm-password" type="password" autoComplete="new-password" required minLength="8" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Save new password'}</button>
        <button type="button" className="text-button" onClick={() => { setMode('forgot'); setMessage('') }}>Request a new link</button>
        {message ? <p className="photo-note" role="alert">{message}</p> : null}
      </form>
    ) : mode === 'forgot' ? (
      <form className="property-form account-form stack" onSubmit={requestReset}>
        <label>Email<input id="account-reset-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</button>
        <button type="button" className="text-button" onClick={() => { setMode('signin'); setMessage('') }}>Back to sign in</button>
        {message ? <p className="photo-note" role="status">{message}</p> : null}
      </form>
    ) : (
      <form className="property-form account-form" onSubmit={submit}>
        {mode === 'signup' ? <label>Name<input id="account-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label> : null}
        <label>Email<input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input id="account-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        {mode === 'signin' ? <button type="button" className="text-button" onClick={() => { setMode('forgot'); setMessage('') }}>Forgot password?</button> : null}
        <button type="button" className="text-button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMessage('') }}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
        {message ? <p className="photo-note" role="alert">{message}</p> : null}
      </form>
    )}
    <div className="account-live">
      <h2>Live notes</h2>
      <p>Notes show up here as soon as they change. Status: {liveStatus}.</p>
      {member?.token ? <form className="route-bar" onSubmit={saveNote}>
        <label>Note<input id="activity-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength="120" placeholder="e.g. Viewing in Molyko tomorrow" /></label>
        <button className="primary" type="submit">Save note</button>
      </form> : <p className="photo-note">Sign in to read and save live notes.</p>}
      <ul>{notes.map((item) => <li key={item.id}>{item.note}</li>)}</ul>
    </div>
  </section>
}
