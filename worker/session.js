import { findAuthUser, findAuthUserById } from './db.js'

const LOCAL_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'https://usefindam.com',
  'https://www.usefindam.com',
  'https://findam.findam-react.workers.dev',
]
const SESSION_COOKIES = [
  '__Secure-neon-auth.session_token',
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
  'neon-auth.session_token',
]

export function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return new Set([...LOCAL_ORIGINS, ...configured])
}

export function isAdmin(user, env) {
  const rootAdminEmail = String(env.ROOT_ADMIN_EMAIL || '').trim().toLowerCase()
  return Boolean(rootAdminEmail && rootAdminEmail === String(user?.email || '').trim().toLowerCase())
}

function sessionUser(body) {
  const user = body?.user || body?.data?.user
  if (!user?.id || !user?.email) return null
  return {
    id: String(user.id),
    email: String(user.email),
    name: String(user.name || ''),
  }
}

async function readSession(env, origin, headers) {
  const response = await fetch(`${env.NEON_AUTH_BASE_URL}/get-session`, {
    headers: { origin, ...headers },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) return null
  return sessionUser(await response.json())
}

let signingKeysCache = { url: '', expires: 0, keys: [] }

function base64UrlToBytes(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(value || '').length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function base64UrlToJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)))
}

async function signingKeys(env) {
  const url = `${String(env.NEON_AUTH_BASE_URL || '').replace(/\/$/, '')}/.well-known/jwks.json`
  if (!url.startsWith('https://')) return []
  if (signingKeysCache.url === url && signingKeysCache.expires > Date.now() && signingKeysCache.keys.length) return signingKeysCache.keys
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) return signingKeysCache.keys
  const body = await response.json()
  const keys = Array.isArray(body.keys) ? body.keys : []
  signingKeysCache = { url, expires: Date.now() + 10 * 60 * 1000, keys }
  return keys
}

function sameAuthHost(baseUrl, issuer) {
  try {
    return new URL(baseUrl).host === new URL(issuer).host
  } catch {
    return false
  }
}

async function userFromVerifiedJwt(env, token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return null
  const header = base64UrlToJson(parts[0])
  if (header.alg !== 'EdDSA') return null
  const keys = (await signingKeys(env)).filter((key) => key.kty === 'OKP' && key.crv === 'Ed25519' && (!header.kid || key.kid === header.kid))
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const signature = base64UrlToBytes(parts[2])
  let verified = false
  for (const jwk of keys) {
    try {
      const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x, alg: 'EdDSA' }, { name: 'Ed25519' }, false, ['verify'])
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, data)) {
        verified = true
        break
      }
    } catch {}
  }
  if (!verified) return null
  const payload = base64UrlToJson(parts[1])
  if (!payload?.exp || payload.exp * 1000 <= Date.now()) return null
  if (payload.banned === true) return null
  if (!sameAuthHost(env.NEON_AUTH_BASE_URL, payload.iss)) return null
  const id = String(payload.sub || payload.id || '').trim()
  const email = String(payload.email || '').trim()
  if (!id || !email.includes('@')) return null
  if (env.DATABASE_URL) {
    try {
      return await findAuthUserById(env.DATABASE_URL, id)
    } catch {}
  }
  return { id, email, name: String(payload.name || '') }
}

function cookieValue(cookie, name) {
  for (const part of String(cookie || '').split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName !== name) continue
    try {
      return decodeURIComponent(rest.join('=')).trim()
    } catch {
      return ''
    }
  }
  return ''
}

export async function requireUser(request, env, extraToken = '') {
  if (!env.NEON_AUTH_BASE_URL) return null
  const header = request.headers.get('authorization') || ''
  const headerToken = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const cookie = request.headers.get('cookie') || ''
  const siteToken = cookieValue(cookie, 'findam_session')
  const tokens = [...new Set([headerToken, String(extraToken || '').trim(), siteToken].filter((value) => value.length >= 8 && value.length <= 4000))]
  const hasCookie = cookie.includes('session_token')
  if (!tokens.length && !hasCookie) return null
  const requestOrigin = (request.headers.get('origin') || '').replace(/\/$/, '')
  if (requestOrigin && !allowedOrigins(env).has(requestOrigin)) return null
  const origin = requestOrigin || LOCAL_ORIGINS[0]

  if (env.DATABASE_URL) {
    for (const token of tokens) {
      if (!token.startsWith('eyJ')) {
        try {
          const fromDatabase = await findAuthUser(env.DATABASE_URL, token)
          if (fromDatabase) return fromDatabase
        } catch {}
      }
      try {
        const fromJwt = await userFromVerifiedJwt(env, token)
        if (fromJwt) return fromJwt
      } catch {}
    }
  }
  for (const token of tokens) {
    try {
      const fromJwt = await userFromVerifiedJwt(env, token)
      if (fromJwt) return fromJwt
    } catch {}
  }
  for (const token of tokens) {
    try {
      const fromBearer = await readSession(env, origin, { authorization: `Bearer ${token}` })
      if (fromBearer) return fromBearer
    } catch {}
    for (const name of SESSION_COOKIES) {
      try {
        const fromCookie = await readSession(env, origin, { cookie: `${name}=${token}` })
        if (fromCookie) return fromCookie
      } catch {}
    }
  }
  if (hasCookie) {
    try {
      return await readSession(env, origin, { cookie })
    } catch {
      return null
    }
  }
  return null
}
