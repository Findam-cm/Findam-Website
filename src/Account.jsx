import { useEffect, useState } from 'react'
import { createRealtimeClient } from '@neon/realtime/client'
import { authClient } from './auth.js'

export default function Account() {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [greeting, setGreeting] = useState('')
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
      }
      setLoading(false)
    }).catch(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    let ignore = false
    fetch('/api/hello')
      .then((response) => response.ok ? response.text() : Promise.reject())
      .then((text) => { if (!ignore) setGreeting(text) })
      .catch(() => { if (!ignore) setGreeting('') })
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    const url = import.meta.env.VITE_NEON_REALTIME_URL
    if (!url) return undefined
    let stop = () => {}
    let client
    let ignore = false
    fetch('/api/realtime/activity', { method: 'POST' })
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
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const result = mode === 'signup'
      ? await authClient.signUp.email({ name: name.trim() || email.split('@')[0] || 'Member', email, password })
      : await authClient.signIn.email({ email, password })
    if (result.error) {
      setMessage(result.error.message || 'The account request was rejected.')
      setBusy(false)
      return
    }
    const sessionResult = await authClient.getSession()
    if (sessionResult.data?.session && sessionResult.data?.user) {
      setSession(sessionResult.data.session)
      setUser(sessionResult.data.user)
      setPassword('')
    } else {
      setMessage('Account saved. Check your email if a confirmation is required, then sign in.')
    }
    setBusy(false)
  }

  const signOut = async () => {
    await authClient.signOut()
    setSession(null)
    setUser(null)
  }

  const saveNote = async (event) => {
    event.preventDefault()
    const text = note.trim()
    if (text.length < 2) return
    setNote('')
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: text }),
    })
  }

  return <section className="shell section">
    <p className="kicker">YOUR ACCOUNT</p>
    <h1 className="page-title">Sign in to Findam</h1>
    <p className="lead">Save a shortlist, list a property, and follow new notes as they are saved.</p>
    {greeting ? <p className="account-greeting">{greeting}</p> : null}
    {loading ? <p>Checking your session…</p> : session && user ? (
      <div className="success"><p>Signed in as {user.email}</p><button className="secondary" onClick={signOut}>Sign out</button></div>
    ) : (
      <form className="property-form account-form" onSubmit={submit}>
        {mode === 'signup' ? <label>Name<input id="account-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label> : null}
        <label>Email<input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input id="account-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="text-button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMessage('') }}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
        {message ? <p className="photo-note" role="alert">{message}</p> : null}
      </form>
    )}
    <div className="account-live">
      <h2>Live notes</h2>
      <p>Saved in Postgres and shown here as soon as they change. Status: {liveStatus}.</p>
      <form className="route-bar" onSubmit={saveNote}>
        <label>Note<input id="activity-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength="120" placeholder="e.g. Viewing in Molyko tomorrow" /></label>
        <button className="primary" type="submit">Save note</button>
      </form>
      <ul>{notes.map((item) => <li key={item.id}>{item.note}</li>)}</ul>
    </div>
  </section>
}
