import { seed } from './seed.js'
import { addAlert, addReferral, checkPostgres, creditAccount, deleteAlert, listAlerts, listPendingReferrals, markAlertsSeen, openListingContact, reviewReferral } from './db.js'
import { allowedOrigins, isAdmin, requireUser } from './session.js'
import { EMPTY_FILTERS, describeFilters, matchesFilters } from '../src/filters.js'

const TYPES = ['Rent', 'Sale', 'Guest house']
const MIN_PRICE = 500
const MAX_PRICE = 10_000_000_000
const MAX_PHOTOS = 6
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const SAMPLE_IDS = new Set(['1', '2', '3', '4', '5', '6'])
const PHOTO_MAGIC = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/gif': [0x47, 0x49, 0x46],
}

function corsHeaders(request, env) {
  const origin = (request.headers.get('origin') || '').replace(/\/$/, '')
  const headers = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    vary: 'origin',
  }
  if (origin && allowedOrigins(env).has(origin)) headers['access-control-allow-origin'] = origin
  return headers
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request, env), 'content-type': 'application/json; charset=utf-8' },
  })
}

function isPublicListing(listing) {
  const status = listing.status || 'published'
  return status === 'published' || status === 'verified'
}

function publicListing(listing) {
  const { phone, submittedBy, submittedEmail, ...visible } = listing
  if (SAMPLE_IDS.has(String(listing.id))) visible.sample = true
  visible.available = listing.available !== false
  return visible
}

function wholeNumber(value, max) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const number = Number(text)
  if (!Number.isInteger(number) || number < 0 || number > max) return undefined
  return number
}

// Accepts full FCFA amounts ("150000" or "150,000"). Older pages sent thousands, flagged by a missing priceUnit.
function readPrice(form) {
  const raw = Number(String(form.get('price') || '').replace(/[\s,]/g, ''))
  if (!Number.isFinite(raw) || raw <= 0) return null
  const amount = form.get('priceUnit') === 'fcfa' ? raw : raw * 1000
  const rounded = Math.round(amount)
  return rounded >= MIN_PRICE && rounded <= MAX_PRICE ? rounded : null
}

function cleanFilters(input) {
  const f = { ...EMPTY_FILTERS }
  const source = input && typeof input === 'object' ? input : {}
  if (seed.cities.includes(source.city)) f.city = source.city
  if (TYPES.includes(source.type)) f.type = source.type
  f.query = String(source.query || '').trim().slice(0, 60)
  const amount = (value) => {
    const number = Math.round(Number(value))
    return Number.isFinite(number) && number > 0 && number <= MAX_PRICE ? number : null
  }
  f.minPrice = amount(source.minPrice)
  f.maxPrice = amount(source.maxPrice)
  f.budgetPeriod = source.budgetPeriod === 'year' ? 'year' : 'month'
  f.beds = Math.min(Math.max(Math.round(Number(source.beds) || 0), 0), 5)
  return f
}

// Exact house pins are set by the admin only. Accept points inside Cameroon's bounding box.
function readPoint(lat, lng) {
  const y = Number(lat)
  const x = Number(lng)
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null
  if (y < 1.6 || y > 13.2 || x < 8.3 || x > 16.3) return null
  return { lat: Math.round(y * 1e6) / 1e6, lng: Math.round(x * 1e6) / 1e6 }
}

async function setExactLocation(bucket, listingId, point) {
  return withCatalog(async () => {
    const catalog = await readCatalog(bucket)
    const listing = findListing(catalog, listingId)
    if (!listing) return { error: 'That listing was not found.', status: 404 }
    if (point) {
      listing.lat = point.lat
      listing.lng = point.lng
      listing.exact = true
    } else {
      const center = catalog.cityCenters[listing.city]
      listing.lat = center?.lat
      listing.lng = center?.lng
      listing.exact = false
    }
    await writeCatalog(bucket, catalog)
    return { ok: true, id: String(listing.id), exact: listing.exact, lat: listing.lat, lng: listing.lng }
  })
}

function findListing(catalog, id) {
  const target = String(id)
  return catalog.listings.find((item) => String(item.id) === target)
    || catalog.submissions.find((item) => String(item.id) === target)
    || null
}

function photoBytesMatch(type, bytes) {
  if (type === 'image/webp') {
    return bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  }
  const magic = PHOTO_MAGIC[type]
  return Boolean(magic) && magic.every((value, index) => bytes[index] === value)
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

let catalogChain = Promise.resolve()

function withCatalog(task) {
  const run = catalogChain.then(task, task)
  catalogChain = run.then(() => undefined, () => undefined)
  return run
}

async function createListing(request, bucket, user, env, formData) {
  const form = formData || await request.formData()
  const title = String(form.get('title') || '').trim().slice(0, 120)
  const city = String(form.get('city') || '').trim()
  const type = String(form.get('type') || '').trim()
  const neighbourhood = String(form.get('neighbourhood') || '').trim().slice(0, 80)
  const phone = String(form.get('phone') || '').trim().slice(0, 20)
  const price = readPrice(form)
  const period = type === 'Sale' ? 'sale' : type === 'Guest house' ? 'night' : form.get('period') === 'year' ? 'year' : 'month'
  const beds = wholeNumber(form.get('beds'), 50)
  const baths = wholeNumber(form.get('baths'), 50)
  const size = wholeNumber(form.get('size'), 100000)
  const details = String(form.get('description') || '').trim().slice(0, 600)
  const catalog = await readCatalog(bucket)
  const knownCity = catalog.cities.includes(city)
  if (!title || !knownCity || !TYPES.includes(type) || !neighbourhood || phone.length < 8 || !price) {
    return json({ error: 'Check the title, city, neighbourhood, type, price (full amount in FCFA), and phone number.' }, 400, request, env)
  }
  if (beds === undefined || baths === undefined || size === undefined) {
    return json({ error: 'Bedrooms, bathrooms and size must be whole numbers.' }, 400, request, env)
  }

  const files = form.getAll('photos').filter((file) => file && typeof file.arrayBuffer === 'function' && file.size)
  if (files.length > MAX_PHOTOS) return json({ error: 'Upload up to 6 photos.' }, 400, request, env)

  const prepared = []
  for (const file of files) {
    const typeName = String(file.type || '').toLowerCase()
    if (file.size > MAX_PHOTO_BYTES) {
      return json({ error: 'Each photo must be a JPEG, PNG, WEBP, or GIF of 5 MB or less.' }, 400, request, env)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!photoBytesMatch(typeName, bytes)) {
      return json({ error: 'Each photo must be a JPEG, PNG, WEBP, or GIF of 5 MB or less.' }, 400, request, env)
    }
    prepared.push({ type: typeName, bytes })
  }

  const id = crypto.randomUUID()
  const photos = []
  for (let index = 0; index < prepared.length; index += 1) {
    const file = prepared[index]
    await bucket.put(`photos/${id}/${index}`, file.bytes, {
      httpMetadata: { contentType: file.type },
    })
    photos.push(`/api/photos/${id}/${index}`)
  }

  const center = catalog.cityCenters[city]
  const exactPoint = isAdmin(user, env) ? readPoint(form.get('exactLat'), form.get('exactLng')) : null
  await withCatalog(async () => {
    const latest = await readCatalog(bucket)
    latest.submissions.push({
      id,
      title,
      type,
      city,
      neighbourhood,
      lat: exactPoint ? exactPoint.lat : center?.lat,
      lng: exactPoint ? exactPoint.lng : center?.lng,
      exact: Boolean(exactPoint),
      price,
      period,
      beds,
      baths,
      size,
      hue: 26,
      featured: false,
      status: 'pending',
      available: true,
      photos,
      phone,
      submittedBy: user.id,
      submittedEmail: user.email,
      description: details || `${title} in ${neighbourhood}, ${city}.`,
      createdAt: new Date().toISOString(),
    })
    await writeCatalog(bucket, latest)
  })
  return json({ ok: true, id, storage: 'r2' }, 201, request, env)
}

async function servePhoto(url, bucket, request, env) {
  const match = url.pathname.match(/^\/api\/photos\/([0-9a-f-]{36})\/(\d+)$/i)
  if (!match) return json({ error: 'Photo not found.' }, 404, request, env)
  const catalog = await readCatalog(bucket)
  const listing = [...catalog.listings, ...catalog.submissions].find((item) => String(item.id) === match[1])
  if (listing && !isPublicListing(listing)) {
    const user = await requireUser(request, env)
    if (!user) return json({ error: 'Sign in to view this photo.' }, 401, request, env)
    if (listing.submittedBy !== user.id && !isAdmin(user, env)) {
      return json({ error: 'This photo is waiting for review.' }, 403, request, env)
    }
  }
  const object = await bucket.get(`photos/${match[1]}/${match[2]}`)
  if (!object) return json({ error: 'Photo not found.' }, 404, request, env)
  const type = object.httpMetadata?.contentType || ''
  if (!PHOTO_MAGIC[type] && type !== 'image/webp') {
    return json({ error: 'Photo not found.' }, 404, request, env)
  }
  return new Response(object.body, {
    headers: {
      ...corsHeaders(request, env),
      'content-type': type,
      'cache-control': listing && isPublicListing(listing) ? 'public, max-age=86400' : 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function reviewListing(bucket, listingId, decision) {
  if (decision !== 'accepted' && decision !== 'rejected') return { error: 'Choose accept or reject.', status: 400 }
  return withCatalog(async () => {
    const catalog = await readCatalog(bucket)
    const listing = catalog.submissions.find((item) => String(item.id) === String(listingId))
    if (!listing) return { error: 'That listing was not found.', status: 404 }
    if (listing.status !== 'pending') return { error: 'This listing has already been reviewed.', status: 409 }
    listing.status = decision === 'accepted' ? 'published' : 'rejected'
    if (decision === 'accepted') {
      listing.featured = false
      listing.available = true
      listing.publishedAt = new Date().toISOString()
    }
    await writeCatalog(bucket, catalog)
    return { ok: true, status: listing.status }
  })
}

// The owner who submitted a listing, or the admin, can mark it taken or available again.
async function setAvailability(bucket, listingId, user, admin, available) {
  return withCatalog(async () => {
    const catalog = await readCatalog(bucket)
    const listing = findListing(catalog, listingId)
    if (!listing) return { error: 'That listing was not found.', status: 404 }
    if (!admin && listing.submittedBy !== user.id) return { error: 'Only the owner or an admin can change this listing.', status: 403 }
    listing.available = Boolean(available)
    listing.availabilityChangedAt = new Date().toISOString()
    await writeCatalog(bucket, catalog)
    return { ok: true, id: String(listing.id), available: listing.available }
  })
}

function ownerView(listing) {
  const { submittedBy, ...visible } = listing
  return { ...visible, available: listing.available !== false }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Homes published after the alert was created that match it. "fresh" ones arrived since the user last looked.
function alertMatches(catalog, alert) {
  const seen = Date.parse(alert.seen_at) || 0
  const created = Date.parse(alert.created_at) || 0
  return [...catalog.listings, ...catalog.submissions]
    .filter(isPublicListing)
    .map((listing) => ({ listing, added: Date.parse(listing.publishedAt || listing.createdAt || '') || 0 }))
    .filter(({ listing, added }) => added > created && listing.available !== false && matchesFilters(listing, alert.filters))
    .sort((a, b) => b.added - a.added)
    .slice(0, 20)
    .map(({ listing, added }) => ({ ...publicListing(listing), fresh: added > seen }))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const fail = (body, status = 200) => json(body, status, request, env)
    if (!url.pathname.startsWith('/api')) {
      if (env.ASSETS) return env.ASSETS.fetch(request)
      const site = String(env.SITE_URL || 'http://127.0.0.1:5173/').trim()
      return fail({ ok: true, site, message: 'This address is the Findam API. Open the site URL to use the website.' })
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request, env) })
    if (!env.LISTINGS) return fail({ error: 'R2 bucket LISTINGS is not connected.' }, 500)

    if (url.pathname === '/api/health' && request.method === 'GET') {
      const postgres = await checkPostgres(env.DATABASE_URL)
      return fail({ ok: postgres === 'connected' })
    }

    if (url.pathname === '/api/hello' && request.method === 'GET') {
      if (!env.NEON_FUNCTION_HELLO_BASE_URL) return fail({ error: 'The hello function is not configured.' }, 500)
      const upstream = await fetch(env.NEON_FUNCTION_HELLO_BASE_URL, { signal: AbortSignal.timeout(15000) })
      const text = await upstream.text()
      return new Response(text, { status: upstream.status, headers: { ...corsHeaders(request, env), 'content-type': 'text/plain; charset=utf-8' } })
    }

    if (url.pathname === '/api/alerts' && request.method === 'GET') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to see your alerts.' }, 401)
      const [alerts, catalog] = await Promise.all([listAlerts(env.DATABASE_URL, user.id), readCatalog(env.LISTINGS)])
      const withMatches = alerts.map((alert) => ({ ...alert, matches: alertMatches(catalog, alert) }))
      const unread = new Set(withMatches.flatMap((alert) => alert.matches.filter((item) => item.fresh).map((item) => String(item.id)))).size
      return fail({ alerts: withMatches, unread })
    }

    if (url.pathname === '/api/alerts' && request.method === 'POST') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to save an alert.' }, 401)
      const body = await request.json().catch(() => ({}))
      const filters = cleanFilters(body.filters)
      const saved = await addAlert(env.DATABASE_URL, user.id, filters, describeFilters(filters).slice(0, 160))
      if (saved.error) return fail({ error: saved.error }, saved.status)
      return fail({ alert: { ...saved.alert, matches: [] } }, 201)
    }

    if (url.pathname === '/api/alerts/seen' && request.method === 'POST') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to update your alerts.' }, 401)
      return fail(await markAlertsSeen(env.DATABASE_URL, user.id))
    }

    const alertDelete = url.pathname.match(/^\/api\/alerts\/([^/]+)\/delete$/)
    if (alertDelete && request.method === 'POST') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to update your alerts.' }, 401)
      const id = decodeURIComponent(alertDelete[1])
      if (!UUID.test(id)) return fail({ error: 'That alert was not found.' }, 404)
      const removed = await deleteAlert(env.DATABASE_URL, user.id, id)
      if (removed.error) return fail({ error: removed.error }, removed.status)
      return fail(removed)
    }

    if (url.pathname === '/api/my/listings' && request.method === 'GET') {
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to see your listings.' }, 401)
      const catalog = await readCatalog(env.LISTINGS)
      const mine = catalog.submissions.filter((item) => item.submittedBy === user.id).map(ownerView)
      return fail({ listings: mine.reverse() })
    }

    const availabilityMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/availability$/)
    if (availabilityMatch && request.method === 'POST') {
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to update a listing.' }, 401)
      const body = await request.json().catch(() => ({}))
      if (typeof body.available !== 'boolean') return fail({ error: 'Say whether the home is available.' }, 400)
      const changed = await setAvailability(env.LISTINGS, decodeURIComponent(availabilityMatch[1]), user, isAdmin(user, env), body.available)
      if (changed.error) return fail({ error: changed.error }, changed.status)
      return fail(changed)
    }

    if (url.pathname === '/api/credits' && request.method === 'GET') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in before checking your score.' }, 401)
      return fail({ ...(await creditAccount(env.DATABASE_URL, user.id)), admin: isAdmin(user, env) })
    }

    if (url.pathname === '/api/admin/referrals' && request.method === 'GET') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in before reviewing referrals.' }, 401)
      if (!isAdmin(user, env)) return fail({ error: 'Only an admin can review referrals.' }, 403)
      return fail({ referrals: await listPendingReferrals(env.DATABASE_URL) })
    }

    const reviewMatch = url.pathname.match(/^\/api\/admin\/referrals\/([^/]+)$/)
    if (reviewMatch && request.method === 'POST') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in before reviewing referrals.' }, 401)
      if (!isAdmin(user, env)) return fail({ error: 'Only an admin can review referrals.' }, 403)
      const body = await request.json().catch(() => ({}))
      const reviewed = await reviewReferral(env.DATABASE_URL, decodeURIComponent(reviewMatch[1]), body.decision)
      if (reviewed.error) return fail({ error: reviewed.error }, reviewed.status)
      return fail(reviewed)
    }

    if (url.pathname === '/api/admin/listings' && request.method === 'GET') {
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in before reviewing listings.' }, 401)
      if (!isAdmin(user, env)) return fail({ error: 'Only an admin can review listings.' }, 403)
      const catalog = await readCatalog(env.LISTINGS)
      const listings = catalog.submissions
        .filter((item) => item.status === 'pending')
        .map(({ phone, submittedBy, ...item }) => ({ ...item, phone, submittedBy }))
      return fail({ listings })
    }

    const locationMatch = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)\/location$/)
    if (locationMatch && request.method === 'POST') {
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to update a listing.' }, 401)
      if (!isAdmin(user, env)) return fail({ error: 'Only an admin can set the exact location.' }, 403)
      const body = await request.json().catch(() => ({}))
      const point = body.clear ? null : readPoint(body.lat, body.lng)
      if (!body.clear && !point) return fail({ error: 'Choose a point inside Cameroon on the map.' }, 400)
      const saved = await setExactLocation(env.LISTINGS, decodeURIComponent(locationMatch[1]), point)
      if (saved.error) return fail({ error: saved.error }, saved.status)
      return fail(saved)
    }

    const listingReview = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)$/)
    if (listingReview && request.method === 'POST') {
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in before reviewing listings.' }, 401)
      if (!isAdmin(user, env)) return fail({ error: 'Only an admin can review listings.' }, 403)
      const body = await request.json().catch(() => ({}))
      const reviewed = await reviewListing(env.LISTINGS, decodeURIComponent(listingReview[1]), body.decision)
      if (reviewed.error) return fail({ error: reviewed.error }, reviewed.status)
      return fail(reviewed)
    }

    if (url.pathname === '/api/referrals' && request.method === 'POST') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in before sending a referral.' }, 401)
      const catalog = await readCatalog(env.LISTINGS)
      const body = await request.json().catch(() => ({}))
      const saved = await addReferral(env.DATABASE_URL, user, { ...body, cities: catalog.cities })
      if (saved.error) return fail({ error: saved.error, score: saved.score }, saved.status)
      // One form can also introduce the property's landlord, which is saved as its own referral.
      const landlord = body.landlord && typeof body.landlord === 'object' ? body.landlord : null
      if (body.kind !== 'property' || !landlord) return fail(saved, 201)
      const landlordSaved = await addReferral(env.DATABASE_URL, user, {
        kind: 'landlord',
        contactName: landlord.sameAsContact ? body.contactName : landlord.contactName,
        phone: landlord.sameAsContact ? body.phone : landlord.phone,
        city: body.city,
        neighbourhood: body.neighbourhood,
        detail: `Landlord of the property referred together: ${String(body.detail || '').slice(0, 180)}`,
        cities: catalog.cities,
      })
      if (landlordSaved.error) {
        const account = await creditAccount(env.DATABASE_URL, user.id)
        return fail({ ...account, referral: saved.referral, landlordError: landlordSaved.error }, 201)
      }
      return fail({ ...landlordSaved, referral: saved.referral, landlordReferral: landlordSaved.referral }, 201)
    }

    const contactMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/contact$/)
    if (contactMatch && request.method === 'POST') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to open a property contact.' }, 401)
      const catalog = await readCatalog(env.LISTINGS)
      const listing = [...catalog.listings, ...catalog.submissions].find((item) => String(item.id) === decodeURIComponent(contactMatch[1]))
      if (!listing || !isPublicListing(listing)) return fail({ error: 'That property is no longer listed.' }, 404)
      if (listing.available === false) return fail({ error: 'This home has been taken, so its contact is closed. No credit was used.' }, 410)
      if (listing.sample || SAMPLE_IDS.has(String(listing.id)) || !listing.phone) {
        const account = await creditAccount(env.DATABASE_URL, user.id)
        return fail({
          ok: true,
          phone: null,
          title: listing.title,
          score: account.score,
          freeFinder: account.freeFinder,
          sample: Boolean(listing.sample || SAMPLE_IDS.has(String(listing.id))),
        })
      }
      const opened = await openListingContact(env.DATABASE_URL, user.id, listing.id)
      if (opened.error) return fail(opened, opened.status)
      return fail({ ...opened, phone: listing.phone, title: listing.title, sample: false })
    }

    if (url.pathname === '/api/listings' && request.method === 'GET') {
      const catalog = await readCatalog(env.LISTINGS)
      const listings = [...catalog.listings, ...catalog.submissions].filter(isPublicListing).map(publicListing)
      return fail({ storage: 'r2', cities: catalog.cities, listings })
    }

    if (url.pathname === '/api/listings' && request.method === 'POST') {
      let form
      try {
        form = await request.formData()
      } catch {
        return fail({ error: 'Check the title, city, neighbourhood, type, price, and phone number.' }, 400)
      }
      const sessionToken = String(form.get('sessionToken') || '').trim().slice(0, 500)
      const user = await requireUser(request, env, sessionToken)
      if (!user) return fail({ error: 'Sign in before listing a property.' }, 401)
      return createListing(request, env.LISTINGS, user, env, form)
    }

    if (url.pathname.startsWith('/api/photos/') && request.method === 'GET') {
      return servePhoto(url, env.LISTINGS, request, env)
    }

    return fail({ error: 'Not found.' }, 404)
  },
}
