import { seed } from './seed.js'
import { latestPass, unlockHome } from './db.js'
import { addAlert, addReferral, checkPostgres, createReward, deleteAlert, findAcceptedReferralByPhone, getReferral, getReward, listAlerts, listPendingReferrals, listRewards, markAlertsSeen, memberAccount, reviewReferral, rewardsForListing, transitionReward } from './db.js'
import { applicationStatus, mesombConfigured } from './mesomb.js'
import { landlordView, refreshReward, startCollect, startPayout } from './rewards.js'
import { buyPass, passSettings, passSummary, passView, refreshPass, upgradePass } from './passes.js'
import { CATEGORIES, listingCategory } from '../src/category.js'
import { allowedOrigins, isAdmin, requireUser } from './session.js'
import { EMPTY_FILTERS, describeFilters, matchesFilters } from '../src/filters.js'

const TYPES = ['Rent', 'Sale', 'Guest house']
const MIN_PRICE = 500
const MAX_PRICE = 10_000_000_000
const MAX_PHOTOS = 6
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const MAX_THUMB_BYTES = 600 * 1024
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
  const headers = new Headers({ ...corsHeaders(request, env), 'content-type': 'application/json; charset=utf-8' })
  return new Response(JSON.stringify(body), { status, headers: securityHeaders(headers, '/api') })
}

function isPublicListing(listing) {
  const status = listing.status || 'published'
  return status === 'published' || status === 'verified'
}

function publicListing(listing) {
  const { phone, submittedBy, submittedEmail, visitConfirmedBy, ...visible } = listing
  if (SAMPLE_IDS.has(String(listing.id))) visible.sample = true
  visible.available = listing.available !== false
  visible.category = listingCategory(listing)
  // The exact house position is part of the locked details (access pass); the public data only
  // says that an exact pin exists.
  if (listing.exact) {
    delete visible.lat
    delete visible.lng
  }
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

async function confirmVisit(bucket, listingId, adminEmail) {
  return withCatalog(async () => {
    const catalog = await readCatalog(bucket)
    const listing = findListing(catalog, listingId)
    if (!listing) return { error: 'That listing was not found.', status: 404 }
    listing.visitConfirmedAt = new Date().toISOString()
    listing.visitConfirmedBy = adminEmail
    await writeCatalog(bucket, catalog)
    return { listing }
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
  const chosenCategory = CATEGORIES[form.get('category')] ? String(form.get('category')) : null
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
    // Optional small copy made by the browser for listing cards (same picture, fewer pixels).
    const thumbFile = form.get(`thumb_${prepared.length}`)
    let thumb = null
    if (thumbFile && typeof thumbFile.arrayBuffer === 'function' && thumbFile.size && thumbFile.size <= MAX_THUMB_BYTES) {
      const thumbType = String(thumbFile.type || '').toLowerCase()
      const thumbBytes = new Uint8Array(await thumbFile.arrayBuffer())
      if (photoBytesMatch(thumbType, thumbBytes)) thumb = { type: thumbType, bytes: thumbBytes }
    }
    prepared.push({ type: typeName, bytes, thumb })
  }

  const id = crypto.randomUUID()
  const photos = []
  const thumbs = []
  for (let index = 0; index < prepared.length; index += 1) {
    const file = prepared[index]
    await bucket.put(`photos/${id}/${index}`, file.bytes, {
      httpMetadata: { contentType: file.type },
    })
    photos.push(`/api/photos/${id}/${index}`)
    if (file.thumb) {
      await bucket.put(`photos/${id}/${index}-t`, file.thumb.bytes, { httpMetadata: { contentType: file.thumb.type } })
      thumbs.push(`/api/photos/${id}/${index}-t`)
    } else {
      thumbs.push(`/api/photos/${id}/${index}`)
    }
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
      thumbs,
      phone,
      submittedBy: user.id,
      submittedEmail: user.email,
      description: details || `${title} in ${neighbourhood}, ${city}.`,
      category: chosenCategory || listingCategory({ title, description: details, beds, type }),
      createdAt: new Date().toISOString(),
    })
    await writeCatalog(bucket, latest)
  })
  return json({ ok: true, id, storage: 'r2' }, 201, request, env)
}

async function servePhoto(url, bucket, request, env) {
  const match = url.pathname.match(/^\/api\/photos\/([0-9a-f-]{36})\/(\d+(?:-t)?)$/i)
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
  const headers = new Headers({
    ...corsHeaders(request, env),
    'content-type': type,
    'cache-control': listing && isPublicListing(listing) ? 'public, max-age=604800' : 'private, no-store',
  })
  return new Response(object.body, { headers: securityHeaders(headers, '/api/photos') })
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

const SITE = 'https://usefindam.com'
const PAGE_TITLES = {
  '/': ['FindamCameroon | Verified homes in Bamenda, Buea and Yaounde', 'Find verified homes to rent or buy in Bamenda, Buea and Yaounde. Every listing is checked by an admin before it goes public.'],
  '/homes': ['Homes for rent and sale | Findam', 'Search verified homes in Bamenda, Buea and Yaounde by budget, bedrooms and neighbourhood.'],
  '/cities': ['Findam house finders | Findam', 'Findam house finders cover Bamenda, Buea and Yaounde.'],
  '/how-it-works': ['How Findam works | Findam', 'How Findam checks every listing from visit to move-in.'],
  '/refer': ['Refer a landlord | Findam', 'Join the Findam referral programme: refer a landlord and gain when their homes are listed or let through Findam.'],
  '/list': ['List a property | Findam', 'List your property on Findam and reach serious tenants and buyers.'],
  '/saved': ['Saved homes | Findam', 'Your saved Findam homes.'],
  '/account': ['Your account | Findam', 'Create a free Findam account or sign in.'],
  '/notifications': ['Notifications | Findam', 'Alerts for new homes that match your search.'],
  '/admin': ['Admin | Findam', 'Findam administration.'],
}

const CSP = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com; connect-src 'self' https: wss:; frame-src https://www.google.com https://maps.google.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"

function securityHeaders(headers, pathname) {
  headers.set('Content-Security-Policy', CSP)
  headers.set('Strict-Transport-Security', 'max-age=31536000')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)')
  if (/^\/assets\//.test(pathname)) headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return headers
}

function withHeaders(response, pathname) {
  const copy = new Response(response.body, response)
  securityHeaders(copy.headers, pathname)
  return copy
}

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Serves the single-page app with the right status code and link-preview tags for each address.
async function servePage(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (path === '/sitemap.xml') return sitemap(env)
  if (/\.[a-z0-9]{2,12}$/i.test(path) || path.startsWith('/assets/')) {
    return withHeaders(await env.ASSETS.fetch(request), url.pathname)
  }
  let status = 200
  let [title, description] = PAGE_TITLES[path] || []
  let image = `${SITE}/og-image.png`
  const detail = path.match(/^\/homes\/([^/]+)$/)
  const payPage = /^\/pay\/[0-9a-f]{48}$/.test(path)
  if (payPage) {
    title = 'Referral reward payment | Findam'
    description = 'Pay a Findam referral reward with MTN Mobile Money or Orange Money.'
  } else if (detail) {
    const catalog = await readCatalog(env.LISTINGS)
    const listing = [...catalog.listings, ...catalog.submissions].find((item) => String(item.id) === decodeURIComponent(detail[1]))
    if (listing && isPublicListing(listing)) {
      const n = new Intl.NumberFormat('en-US').format(listing.price)
      const unit = listing.period === 'sale' ? '' : listing.period === 'year' ? ' per year' : listing.period === 'night' ? ' per night' : ' per month'
      title = `${listing.title} in ${listing.neighbourhood}, ${listing.city} | Findam`
      description = `${n} FCFA${unit}. ${listing.beds ? `${listing.beds} bedroom${listing.beds === 1 ? '' : 's'}. ` : ''}${listing.available === false ? 'This home has been taken. ' : ''}${String(listing.description || '').slice(0, 140)}`
      const pic = listing.thumbs?.[0] || listing.photos?.[0]
      if (pic) image = `${SITE}${pic}`
    } else {
      status = 404
      title = 'Home not found | Findam'
      description = 'This home is no longer listed on Findam.'
    }
  } else if (!PAGE_TITLES[path]) {
    status = 404
    title = 'Page not found | Findam'
    description = 'This page does not exist on Findam.'
  }
  // Fetch the page template without the browser's "has it changed?" headers; otherwise a returning
  // visitor gets an empty 304 body, which would render a blank page after the rewrite below.
  const shell = await env.ASSETS.fetch(new Request(new URL('/', url)))
  if (!shell.ok) return withHeaders(shell, url.pathname)
  const canonical = `${SITE}${path === '/' ? '/' : path}${path === '/homes' ? url.search : ''}`
  const rewritten = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title) } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', description) } })
    .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', title.replace(/ \| Findam$/, '')) } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', description) } })
    .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', image) } })
    .on('meta[property="og:url"]', { element(el) { el.setAttribute('content', canonical) } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', canonical) } })
    .on('head', { element(el) { if (status === 404 || payPage || path === '/admin' || path === '/account') el.append('<meta name="robots" content="noindex">', { html: true }) } })
    .transform(shell)
  const response = new Response(rewritten.body, { status, headers: rewritten.headers })
  response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
  response.headers.delete('Content-Length')
  response.headers.delete('ETag')
  return withHeaders(response, url.pathname)
}

async function sitemap(env) {
  const catalog = await readCatalog(env.LISTINGS)
  const pages = ['/', '/homes', '/cities', '/how-it-works', '/list', '/refer', ...catalog.cities.map((city) => `/homes?city=${city.toLowerCase()}`)]
  const homes = [...catalog.listings, ...catalog.submissions].filter((item) => isPublicListing(item) && item.available !== false)
  const urls = [
    ...pages.map((page) => `<url><loc>${escapeAttr(SITE + page)}</loc></url>`),
    ...homes.map((item) => `<url><loc>${SITE}/homes/${encodeURIComponent(item.id)}</loc>${item.publishedAt || item.createdAt ? `<lastmod>${String(item.publishedAt || item.createdAt).slice(0, 10)}</lastmod>` : ''}</url>`),
  ]
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, {
    headers: securityHeaders(new Headers({ 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }), '/sitemap.xml'),
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    // One public address: https://usefindam.com (no http, no www).
    // Local "wrangler dev" reports every request as http://usefindam.com, so it passes --var NO_REDIRECT:1.
    if (!env.NO_REDIRECT && (url.hostname === 'www.usefindam.com' || (url.hostname === 'usefindam.com' && url.protocol === 'http:'))) {
      return Response.redirect(`${SITE}${url.pathname}${url.search}`, 301)
    }
    const fail = (body, status = 200) => json(body, status, request, env)
    if (!url.pathname.startsWith('/api')) {
      if (env.ASSETS) return servePage(request, env, url)
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

    // "/api/credits" is kept as an alias so pages already open in a browser keep working.
    if ((url.pathname === '/api/account' || url.pathname === '/api/credits') && request.method === 'GET') {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to see your account.' }, 401)
      return fail({ ...(await memberAccount(env.DATABASE_URL, user.id)), admin: isAdmin(user, env) })
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

    // Admin sets a listing's category (decides which access pass level can unlock it).
    const categoryMatch = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)\/category$/)
    if (categoryMatch && request.method === 'POST') {
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to update a listing.' }, 401)
      if (!isAdmin(user, env)) return fail({ error: 'Only an admin can change the category.' }, 403)
      const body = await request.json().catch(() => ({}))
      if (!CATEGORIES[body.category]) return fail({ error: 'Choose Room, Studio or Apartment.' }, 400)
      const saved = await withCatalog(async () => {
        const catalog = await readCatalog(env.LISTINGS)
        const listing = findListing(catalog, decodeURIComponent(categoryMatch[1]))
        if (!listing) return null
        listing.category = body.category
        await writeCatalog(env.LISTINGS, catalog)
        return listing
      })
      if (!saved) return fail({ error: 'That listing was not found.' }, 404)
      return fail({ ok: true, id: String(saved.id), category: saved.category })
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
      if (saved.error) return fail({ error: saved.error }, saved.status)
      return fail(saved, 201)
    }

    const contactMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/contact$/)
    // ---- Referral reward payments (MeSomb) ----
    const payMatch = url.pathname.match(/^\/api\/pay\/([0-9a-f]{48})$/)
    if (payMatch && (request.method === 'GET' || request.method === 'POST')) {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      let reward = await getReward(env.DATABASE_URL, { token: payMatch[1] })
      if (!reward) return fail({ error: 'This payment link is not valid.' }, 404)
      const configured = mesombConfigured(env)
      if (request.method === 'GET') {
        if (configured) reward = await refreshReward(env, env.DATABASE_URL, reward)
        return fail(landlordView(reward, configured))
      }
      if (!configured) return fail({ error: 'Mobile Money payments are not switched on yet. Please try again later.' }, 503)
      const body = await request.json().catch(() => ({}))
      const started = await startCollect(env, env.DATABASE_URL, reward, { service: String(body.service || '').toUpperCase(), phone: body.phone })
      if (started.error) return fail({ error: started.error }, started.status)
      return fail(landlordView(started.reward, configured))
    }

    if (url.pathname.startsWith('/api/admin/') && /^\/api\/admin\/(payments|rewards|listings\/[^/]+\/(visit|reward-match))/.test(url.pathname)) {
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in first.' }, 401)
      if (!isAdmin(user, env)) return fail({ error: 'Only an admin can manage referral rewards.' }, 403)
      const db = env.DATABASE_URL
      const configured = mesombConfigured(env)
      const payLink = (reward) => `${url.origin}/pay/${reward.token}`
      const defaultAmount = Math.max(0, Math.round(Number(env.REFERRAL_REWARD_FCFA) || 0)) || null

      if (url.pathname === '/api/admin/payments' && request.method === 'GET') {
        let balance = null
        let problem = null
        if (configured) {
          const status = await applicationStatus(env)
          if (status.ok) balance = (status.data?.balances || []).reduce((sum, item) => sum + Number(item.value || 0), 0)
          else problem = status.error
        }
        return fail({ configured, balance, problem, defaultAmount })
      }

      if (url.pathname === '/api/admin/rewards' && request.method === 'GET') {
        let rewards = await listRewards(db)
        if (configured) {
          const busy = rewards.filter((item) => item.status === 'collecting' || item.status === 'paying_out').slice(0, 5)
          for (const item of busy) await refreshReward(env, db, item)
          if (busy.length) rewards = await listRewards(db)
        }
        return fail({ rewards: rewards.map((item) => ({ ...item, payLink: payLink(item) })), configured })
      }

      const rewardAction = url.pathname.match(/^\/api\/admin\/rewards\/([0-9a-f-]{36})\/(payout|prompt|cancel)$/)
      if (rewardAction && request.method === 'POST') {
        const reward = await getReward(db, { id: rewardAction[1] })
        if (!reward) return fail({ error: 'That reward was not found.' }, 404)
        const body = await request.json().catch(() => ({}))
        if (rewardAction[2] === 'cancel') {
          const cancelled = await transitionReward(db, reward.id, ['requested', 'collect_failed'], 'cancelled', { last_error: 'Cancelled by an admin.' })
          if (!cancelled) return fail({ error: 'Only a reward that has not been paid can be cancelled.' }, 409)
          return fail({ reward: { ...cancelled, payLink: payLink(cancelled) } })
        }
        if (!configured) return fail({ error: 'Connect MeSomb first: add the three MeSomb keys as Worker secrets.' }, 503)
        const done = rewardAction[2] === 'payout'
          ? await startPayout(env, db, reward, String(body.service || '').toUpperCase())
          : await startCollect(env, db, reward, { service: String(body.service || '').toUpperCase(), phone: reward.landlord_phone })
        if (done.error) return fail({ error: done.error }, done.status)
        return fail({ reward: { ...done.reward, payLink: payLink(done.reward) } })
      }

      const listingAction = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)\/(visit|reward-match)$/)
      if (listingAction) {
        const catalog = await readCatalog(env.LISTINGS)
        const listing = findListing(catalog, decodeURIComponent(listingAction[1]))
        if (!listing) return fail({ error: 'That listing was not found.' }, 404)
        if (listingAction[2] === 'reward-match' && request.method === 'GET') {
          const referral = listing.phone ? await findAcceptedReferralByPhone(db, listing.phone) : null
          const existing = await rewardsForListing(db, listing.id)
          return fail({
            listing: { id: String(listing.id), title: listing.title, phone: listing.phone || null, visitConfirmedAt: listing.visitConfirmedAt || null },
            referral: referral ? { id: referral.id, landlord: referral.contact_name, referrerEmail: referral.user_email, referrerPhone: referral.referrer_phone } : null,
            rewards: existing.map((item) => ({ ...item, payLink: payLink(item) })),
            defaultAmount,
            configured,
          })
        }
        if (listingAction[2] === 'visit' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}))
          const confirmed = await confirmVisit(env.LISTINGS, listing.id, user.email)
          if (confirmed.error) return fail({ error: confirmed.error }, confirmed.status)
          if (!body.referralId) return fail({ ok: true, visitConfirmedAt: confirmed.listing.visitConfirmedAt, reward: null })
          const amount = Math.round(Number(body.amount))
          if (!Number.isFinite(amount) || amount < 100 || amount > 5000000) return fail({ error: 'Enter the reward amount in FCFA (at least 100).' }, 400)
          if (!/^[0-9a-f-]{36}$/i.test(String(body.referralId))) return fail({ error: 'Choose the referral to reward.' }, 400)
          const referral = await getReferral(db, body.referralId)
          if (!referral || referral.status !== 'accepted') return fail({ error: 'Only an accepted landlord referral can be rewarded.' }, 400)
          if (!listing.phone) return fail({ error: 'This listing has no landlord phone number to request the payment from.' }, 400)
          const created = await createReward(db, {
            referralId: referral.id,
            listingId: String(listing.id),
            listingTitle: listing.title,
            amount,
            landlordPhone: listing.phone,
            referrerPhone: referral.referrer_phone,
            referrerEmail: referral.user_email,
          })
          if (created.error) return fail({ error: created.error }, created.status)
          return fail({ ok: true, visitConfirmedAt: confirmed.listing.visitConfirmedAt, reward: { ...created.reward, payLink: payLink(created.reward) } }, 201)
        }
      }
      return fail({ error: 'Not found.' }, 404)
    }

    // ---- Access pass ----
    if (url.pathname === '/api/pass' && (request.method === 'GET' || request.method === 'POST')) {
      const settings = passSettings(env)
      const user = await requireUser(request, env)
      if (request.method === 'GET') {
        if (!user || !env.DATABASE_URL) return fail({ ...settings, configured: mesombConfigured(env), active: null, pending: null, admin: false })
        const admin = isAdmin(user, env)
        let latest = await latestPass(env.DATABASE_URL, user.id)
        if (latest?.status === 'pending') latest = await refreshPass(env, env.DATABASE_URL, latest)
        const active = await passSummary(env.DATABASE_URL, user.id)
        return fail({ ...settings, configured: mesombConfigured(env), admin, active, pending: latest?.status === 'pending' ? passView(latest) : null, lastFailed: latest?.status === 'failed' ? passView(latest) : null })
      }
      if (!user) return fail({ error: 'Sign in to buy an access pass.' }, 401)
      if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
      const body = await request.json().catch(() => ({}))
      const request_ = { service: String(body.service || '').toUpperCase(), phone: body.phone, tier: String(body.tier || 'room') }
      const bought = body.upgrade ? await upgradePass(env, env.DATABASE_URL, user, request_) : await buyPass(env, env.DATABASE_URL, user, request_)
      if (bought.error) return fail({ error: bought.error, pass: passView(bought.pass) }, bought.status)
      return fail({ ...settings, pass: passView(bought.pass), active: await passSummary(env.DATABASE_URL, user.id) })
    }

    // A member spends one slot of their pass to unlock a home of their choice.
    const unlockMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/unlock$/)
    // Contact and exact location: only for homes the member unlocked with an active pass (admins always).
    const detailsMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/details$/)
    if ((detailsMatch && request.method === 'GET') || (contactMatch && request.method === 'POST') || (unlockMatch && request.method === 'POST')) {
      const user = await requireUser(request, env)
      if (!user) return fail({ error: 'Sign in to unlock contacts and locations.', locked: true }, 401)
      const catalog = await readCatalog(env.LISTINGS)
      const id = decodeURIComponent((detailsMatch || contactMatch || unlockMatch)[1])
      const listing = [...catalog.listings, ...catalog.submissions].find((item) => String(item.id) === id)
      const admin = isAdmin(user, env)
      if (!listing || (!isPublicListing(listing) && !admin)) return fail({ error: 'That property is no longer listed.' }, 404)
      const sample = Boolean(listing.sample || SAMPLE_IDS.has(String(listing.id)))
      let summary = null
      if (!admin && !sample) {
        if (!env.DATABASE_URL) return fail({ error: 'Postgres is not configured.' }, 500)
        if (listing.available === false) return fail({ error: 'This home has been taken, so its contact is closed.' }, 410)
        summary = await passSummary(env.DATABASE_URL, user.id)
        const unlocked = summary?.homes.includes(String(listing.id))
        const category = listingCategory(listing)
        if (!unlocked && unlockMatch) {
          if (!summary || summary.slotsLeft < 1) {
            return fail({ error: summary ? `You have used all ${summary.maxHomes} homes on your pass. Buy a new pass to unlock more.` : 'Get an access pass first.', locked: true, category, active: summary, ...passSettings(env) }, 402)
          }
          if (!summary.slotsFor[category]) {
            return fail({ error: `This home is ${category === 'apartment' ? 'an apartment' : 'a studio'}. Upgrade to the ${CATEGORIES[category].pass} to unlock it.`, locked: true, needsUpgrade: category, category, active: summary, ...passSettings(env) }, 402)
          }
          await unlockHome(env.DATABASE_URL, user.id, listing.id, CATEGORIES[category].rank)
          summary = await passSummary(env.DATABASE_URL, user.id)
        }
        if (!summary?.homes.includes(String(listing.id))) {
          return fail({ error: summary?.slotsLeft ? 'Unlock this home to see its contact and exact location.' : 'Get an access pass to unlock this home.', locked: true, category, active: summary, ...passSettings(env) }, 402)
        }
      }
      const pass = summary?.passes.find((p) => p.homes.includes(String(listing.id)))
      return fail({
        ok: true,
        title: listing.title,
        sample,
        phone: sample ? null : listing.phone || null,
        exact: Boolean(listing.exact),
        lat: listing.lat ?? null,
        lng: listing.lng ?? null,
        expiresAt: pass?.expiresAt || null,
        active: summary,
      })
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
