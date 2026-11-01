const LOCAL_ORIGINS = new Set(['http://127.0.0.1:5173', 'http://localhost:5173'])

export function isAdmin(user, env) {
  const allowed = [env.EMAIL, env.ADMIN_EMAIL, env.ROOT_ADMIN_EMAIL]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(String(user?.email || '').trim().toLowerCase())
}

export async function requireUser(request, env) {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token || !env.NEON_AUTH_BASE_URL) return null
  const requestOrigin = request.headers.get('origin') || ''
  const origin = LOCAL_ORIGINS.has(requestOrigin) ? requestOrigin : 'http://127.0.0.1:5173'
  try {
    const response = await fetch(`${env.NEON_AUTH_BASE_URL}/get-session`, {
      headers: {
        authorization: `Bearer ${token}`,
        cookie: `better-auth.session_token=${encodeURIComponent(token)}`,
        origin,
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return null
    const body = await response.json()
    if (!body?.user?.id || !body?.user?.email) return null
    return {
      id: String(body.user.id),
      email: String(body.user.email),
      name: String(body.user.name || ''),
    }
  } catch {
    return null
  }
}
