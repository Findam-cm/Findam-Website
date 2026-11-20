// Search filters shared by the website and the Worker (saved alerts use the same rules).
import { monthlyRent } from './price.js'

export const EMPTY_FILTERS = {
  city: '',
  type: '',
  query: '',
  minPrice: null,
  maxPrice: null,
  budgetPeriod: 'month',
  beds: 0,
  sort: 'recommended',
  showTaken: false,
}

const RENTAL_PERIODS = new Set(['month', 'year'])

// The listing price expressed in the same unit as the user's budget.
function comparablePrice(listing, budgetPeriod) {
  if (RENTAL_PERIODS.has(listing.period)) {
    const monthly = monthlyRent(listing)
    return budgetPeriod === 'year' ? monthly * 12 : monthly
  }
  return Number(listing.price)
}

export function isAvailable(listing) {
  return listing.available !== false
}

export function matchesFilters(listing, filters) {
  const f = { ...EMPTY_FILTERS, ...filters }
  if (f.city && listing.city !== f.city) return false
  if (f.type && listing.type !== f.type) return false
  if (!f.showTaken && !isAvailable(listing)) return false
  const beds = Number(f.beds) || 0
  if (beds && !(Number(listing.beds) >= beds)) return false
  const price = comparablePrice(listing, f.budgetPeriod)
  if (f.minPrice && price < Number(f.minPrice)) return false
  if (f.maxPrice && price > Number(f.maxPrice)) return false
  const words = String(f.query || '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (words.length) {
    const haystack = `${listing.title} ${listing.city} ${listing.neighbourhood} ${listing.type}`.toLowerCase()
    if (!words.every((word) => haystack.includes(word))) return false
  }
  return true
}

function addedAt(listing) {
  return Date.parse(listing.publishedAt || listing.createdAt || '') || 0
}

export function sortListings(list, sort, budgetPeriod = 'month') {
  const copy = [...list]
  if (sort === 'price-asc') return copy.sort((a, b) => comparablePrice(a, budgetPeriod) - comparablePrice(b, budgetPeriod))
  if (sort === 'price-desc') return copy.sort((a, b) => comparablePrice(b, budgetPeriod) - comparablePrice(a, budgetPeriod))
  if (sort === 'newest') return copy.sort((a, b) => addedAt(b) - addedAt(a))
  // Recommended: available real listings first, then featured, then the rest.
  const rank = (item) => (isAvailable(item) ? 0 : 4) + (item.sample ? 2 : 0) + (item.featured ? 0 : 1)
  return copy.sort((a, b) => rank(a) - rank(b) || addedAt(b) - addedAt(a))
}

export function activeFilterCount(filters) {
  const f = { ...EMPTY_FILTERS, ...filters }
  return [f.city, f.type, f.query, f.minPrice, f.maxPrice, f.beds, f.showTaken].filter(Boolean).length
}

// URL query string <-> filters, so searches can be shared and linked internally.
export function filtersFromSearch(search) {
  const params = new URLSearchParams(search)
  const amount = (key) => {
    const value = Number(String(params.get(key) || '').replace(/\D/g, ''))
    return value > 0 ? value : null
  }
  const types = { rent: 'Rent', sale: 'Sale', 'guest-house': 'Guest house' }
  return {
    ...EMPTY_FILTERS,
    city: ['Bamenda', 'Buea', 'Yaounde'].find((item) => item.toLowerCase() === String(params.get('city') || '').toLowerCase()) || '',
    type: types[String(params.get('type') || '').toLowerCase()] || '',
    query: String(params.get('q') || '').slice(0, 60),
    minPrice: amount('min'),
    maxPrice: amount('max'),
    budgetPeriod: params.get('per') === 'year' ? 'year' : 'month',
    beds: Math.min(Math.max(Number(params.get('beds')) || 0, 0), 5),
    sort: ['price-asc', 'price-desc', 'newest'].includes(params.get('sort')) ? params.get('sort') : 'recommended',
    showTaken: params.get('taken') === '1',
  }
}

export function filtersToSearch(filters) {
  const f = { ...EMPTY_FILTERS, ...filters }
  const params = new URLSearchParams()
  if (f.city) params.set('city', f.city.toLowerCase())
  if (f.type) params.set('type', f.type.toLowerCase().replace(' ', '-'))
  if (f.query) params.set('q', f.query)
  if (f.minPrice) params.set('min', String(f.minPrice))
  if (f.maxPrice) params.set('max', String(f.maxPrice))
  if ((f.minPrice || f.maxPrice) && f.budgetPeriod === 'year') params.set('per', 'year')
  if (f.beds) params.set('beds', String(f.beds))
  if (f.sort !== 'recommended') params.set('sort', f.sort)
  if (f.showTaken) params.set('taken', '1')
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function homesLink(partial) {
  return `/homes${filtersToSearch({ ...EMPTY_FILTERS, ...partial })}`
}

export function describeFilters(filters) {
  const f = { ...EMPTY_FILTERS, ...filters }
  const parts = []
  parts.push(f.type === 'Guest house' ? 'Guest houses' : f.type === 'Sale' ? 'Homes for sale' : f.type === 'Rent' ? 'Homes for rent' : 'Homes')
  if (f.query) parts.push(`matching "${f.query}"`)
  if (f.city) parts.push(`in ${f.city}`)
  if (f.beds) parts.push(`with ${f.beds}+ bedrooms`)
  const unit = f.type === 'Sale' ? '' : f.type === 'Guest house' ? ' a night' : f.budgetPeriod === 'year' ? ' a year' : ' a month'
  const n = new Intl.NumberFormat('en-US')
  if (f.minPrice && f.maxPrice) parts.push(`from ${n.format(f.minPrice)} to ${n.format(f.maxPrice)} FCFA${unit}`)
  else if (f.maxPrice) parts.push(`up to ${n.format(f.maxPrice)} FCFA${unit}`)
  else if (f.minPrice) parts.push(`from ${n.format(f.minPrice)} FCFA${unit}`)
  return parts.join(' ')
}
