import { seed } from './seed.js'
import { addActivity, addReferral, checkPostgres, countAuthUsers, creditAccount, listPendingReferrals, openListingContact, reviewReferral } from './db.js'
import { sealActivity } from './realtime.js'
import { isAdmin, requireUser } from './session.js'

const TYPES = ['Rent', 'Sale', 'Guest house']
const MAX_PHOTOS = 6
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  })
}

function publicListing(listing) {
  const { phone, ...visible } = listing
  return visible
}

async function readCatalog(bucket) {
  const stored = await bucket.get('catalog.json')
  if (!stored) {
    await bucket.put('catalog.json', JSON.stringify(seed), {
      httpMetadata: { contentType: 'application/json' },
    })
    return structuredClone(seed)
  }
  return stored.json()
}

async function writeCatalog(bucket, catalog) {
  await bucket.put('catalog.json', JSON.stringify(catalog), {
    httpMetadata: { contentType: 'application/json' },
  })
}

async function createListing(request, bucket) {
  const form = await request.formData()
  const title = String(form.get('title') || '').trim().slice(0, 120)
  const city = String(form.get('city') || '').trim()
  const type = String(form.get('type') || '').trim()
  const neighbourhood = String(form.get('neighbourhood') || '').trim().slice(0, 80)
  const phone = String(form.get('phone') || '').trim().slice(0, 20)
  const priceThousands = Number(form.get('price'))
  const catalog = await readCatalog(bucket)
  const knownCity = catalog.cities.includes(city)
  const validPrice = Number.isFinite(priceThousands) && priceThousands > 0 && priceThousands <= 100000000
  if (!title || !knownCity || !TYPES.includes(type) || !neighbourhood || phone.length < 8 || !validPrice) {
    return json({ error: 'Check the title, city, neighbourhood, type, price, and phone number.' }, 400)
  }

  const files = form.getAll('photos').filter((file) => file && typeof file.arrayBuffer === 'function' && file.size)
  if (files.length > MAX_PHOTOS) return json({ error: 'Upload up to 6 photos.' }, 400)

  const id = crypto.randomUUID()
  const photos = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (!String(file.type || '').startsWith('image/') || file.size > MAX_PHOTO_BYTES) {
      return json({ error: 'Each photo must be an image of 5 MB or less.' }, 400)
    }
    await bucket.put(`photos/${id}/${index}`, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })
    photos.push(`/api/photos/${id}/${index}`)
  }

  const center = catalog.cityCenters[city]
  catalog.submissions.push({
    id,
    title,
    type,
    city,
    neighbourhood,
    lat: center?.lat,
    lng: center?.lng,
    price: Math.round(priceThousands * 1000),
    period: type === 'Sale' ? 'sale' : type === 'Guest house' ? 'night' : 'month',
    beds: null,
    baths: null,
    size: null,
    hue: 26,
    featured: false,
    status: 'pending',
    photos,
    phone,
    description: `${title} in ${neighbourhood}, ${city}. Awaiting a house finder visit and an engineer review.`,
    createdAt: new Date().toISOString(),
  })
  await writeCatalog(bucket, catalog)
  return json({ ok: true, id, storage: 'r2' }, 201)
}

async function servePhoto(url, bucket) {
  const match = url.pathname.match(/^\/api\/photos\/([0-9a-f-]{36})\/(\d+)$/i)
  if (!match) return json({ error: 'Photo not found.' }, 404)
  const object = await bucket.get(`photos/${match[1]}/${match[2]}`)
  if (!object) return json({ error: 'Photo not found.' }, 404)
  return new Response(object.body, {
    headers: {
      ...cors,
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
    },
  })
}

async function checkAuth(jwksUrl) {
  if (!jwksUrl) return 'missing'
  try {
    const response = await fetch(jwksUrl, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return 'unavailable'
    const body = await response.json()
    return Array.isArray(body.keys) && body.keys.length ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

async function checkFunction(functionUrl) {
  if (!functionUrl) return 'missing'
  try {
    const response = await fetch(functionUrl, { signal: AbortSignal.timeout(15000) })
    const text = await response.text()
    return response.ok && text.includes('Hello from Neon Functions') ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

async function checkRealtime(env) {
  if (!env.NEON_REALTIME_SECRET || !env.NEON_REALTIME_URL) return 'missing'
  try {
    const sealed = await sealActivity(env)
    return sealed ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (!env.LISTINGS) return json({ error: 'R2 bucket LISTINGS is not connected.' }, 500)

    if (url.pathname === '/api/health' && request.method === 'GET') {
      const catalog = await readCatalog(env.LISTINGS)
      const postgres = await checkPostgres(env.DATABASE_URL)
      const [auth, functions, realtime, authUsers] = await Promise.all([
        checkAuth(env.NEON_AUTH_JWKS_URL),
        checkFunction(env.NEON_FUNCTION_HELLO_BASE_URL),
        checkRealtime(env),
        postgres === 'connected' ? countAuthUsers(env.DATABASE_URL).catch(() => null) : null,
      ])
      return json({
        storage: 'r2',
        postgres,
        auth,
        functions,
        realtime,
        authUsers,
        configured: {
          postgres: Boolean(env.DATABASE_URL),
          auth: Boolean(env.NEON_AUTH_JWKS_URL),
          functions: Boolean(env.NEON_FUNCTION_HELLO_BASE_URL),
          realtime: Boolean(env.NEON_REALTIME_SECRET && env.NEON_REALTIME_URL),
        },
        listings: catalog.listings.length,
        pending: catalog.submissions.length,
      })
    }

    if (url.pathname === '/api/hello' && request.method === 'GET') {
      if (!env.NEON_FUNCTION_HELLO_BASE_URL) return json({ error: 'The hello function is not configured.' }, 500)
      const upstream = await fetch(env.NEON_FUNCTION_HELLO_BASE_URL, { signal: AbortSignal.timeout(15000) })
      const text = await upstream.text()
      return new Response(text, { status: upstream.status, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } })
    }

    if (url.pathname === '/api/activity' && request.method === 'POST') {
      if (!env.DATABASE_URL) return json({ error: 'Postgres is not configured.' }, 500)
      const body = await request.json().catch(() => ({}))
      const note = String(body.note || '').trim().slice(0, 120)
      if (note.length < 2) return json({ error: 'Add a short note.' }, 400)
      const saved = await addActivity(env.DATABASE_URL, note)
      return json({ ok: true, id: saved.row.id, note: saved.row.note, count: saved.count }, 201)
    }

    if (url.pathname === '/api/realtime/activity' && request.method === 'POST') {
      try {
        const sealed = await sealActivity(env)
        if (!sealed) return json({ error: 'Realtime is not configured.' }, 500)
        return json(sealed)
      } catch {
        return json({ error: 'Realtime could not seal the query.' }, 500)
      }
    }

    if (url.pathname === '/api/credits' && request.method === 'GET') {
      if (!env.DATABASE_URL) return json({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return json({ error: 'Sign in before checking your score.' }, 401)
      return json({ ...(await creditAccount(env.DATABASE_URL, user.id)), admin: isAdmin(user, env) })
    }

    if (url.pathname === '/api/admin/referrals' && request.method === 'GET') {
      if (!env.DATABASE_URL) return json({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return json({ error: 'Sign in before reviewing referrals.' }, 401)
      if (!isAdmin(user, env)) return json({ error: 'Only an admin can review referrals.' }, 403)
      return json({ referrals: await listPendingReferrals(env.DATABASE_URL) })
    }

    const reviewMatch = url.pathname.match(/^\/api\/admin\/referrals\/([^/]+)$/)
    if (reviewMatch && request.method === 'POST') {
      if (!env.DATABASE_URL) return json({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return json({ error: 'Sign in before reviewing referrals.' }, 401)
      if (!isAdmin(user, env)) return json({ error: 'Only an admin can review referrals.' }, 403)
      const body = await request.json().catch(() => ({}))
      const reviewed = await reviewReferral(env.DATABASE_URL, decodeURIComponent(reviewMatch[1]), body.decision)
      if (reviewed.error) return json({ error: reviewed.error }, reviewed.status)
      return json(reviewed)
    }

    if (url.pathname === '/api/referrals' && request.method === 'POST') {
      if (!env.DATABASE_URL) return json({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return json({ error: 'Sign in before sending a referral.' }, 401)
      const catalog = await readCatalog(env.LISTINGS)
      const body = await request.json().catch(() => ({}))
      const saved = await addReferral(env.DATABASE_URL, user, { ...body, cities: catalog.cities })
      if (saved.error) return json({ error: saved.error, score: saved.score }, saved.status)
      return json(saved, 201)
    }

    const contactMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/contact$/)
    if (contactMatch && request.method === 'POST') {
      if (!env.DATABASE_URL) return json({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return json({ error: 'Sign in to open a property contact.' }, 401)
      const catalog = await readCatalog(env.LISTINGS)
      const listing = [...catalog.listings, ...catalog.submissions].find((item) => String(item.id) === decodeURIComponent(contactMatch[1]))
      if (!listing) return json({ error: 'That property is no longer listed.' }, 404)
      const opened = await openListingContact(env.DATABASE_URL, user.id, listing.id)
      if (opened.error) return json(opened, opened.status)
      return json({ ...opened, phone: listing.phone || null, title: listing.title })
    }

    if (url.pathname === '/api/listings' && request.method === 'GET') {
      const catalog = await readCatalog(env.LISTINGS)
      const listings = [...catalog.listings, ...catalog.submissions].map(publicListing)
      return json({ storage: 'r2', cities: catalog.cities, agents: catalog.agents, listings })
    }

    if (url.pathname === '/api/listings' && request.method === 'POST') {
      return createListing(request, env.LISTINGS)
    }

    if (url.pathname.startsWith('/api/photos/') && request.method === 'GET') {
      return servePhoto(url, env.LISTINGS)
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return json({ ok: true, site: 'http://127.0.0.1:5173/', message: 'This address is the Findam API. Open the site URL to use the website.' })
    }

    return json({ error: 'Not found.' }, 404)
  },
}
