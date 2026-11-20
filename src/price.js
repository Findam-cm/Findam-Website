// Prices are always stored and typed as full FCFA amounts (150000 means 150,000 FCFA).

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export const PERIODS = {
  month: { short: '/ month', long: 'per month', input: 'Rent per month' },
  year: { short: '/ year', long: 'per year', input: 'Rent per year' },
  night: { short: '/ night', long: 'per night', input: 'Price per night' },
  sale: { short: '', long: 'sale price', input: 'Sale price' },
}

export function formatFcfa(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return `${grouped.format(Math.round(number))} FCFA`
}

export function priceLine(listing) {
  const period = PERIODS[listing.period]
  return `${formatFcfa(listing.price)}${period?.short ? ` ${period.short}` : ''}`
}

// Groups digits while the user types: "150000" -> "150,000".
export function groupDigits(text) {
  const digits = String(text ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12)
  return digits ? grouped.format(Number(digits)) : ''
}

export function toAmount(text) {
  const digits = String(text ?? '').replace(/\D/g, '')
  return digits ? Number(digits) : null
}

// Monthly cost of a rental, so monthly and yearly rents can be compared fairly.
export function monthlyRent(listing) {
  if (listing.period === 'year') return listing.price / 12
  return listing.price
}

// Heading for a min/max price range in the search filters.
export function budgetLegend(type, budgetPeriod = 'month') {
  if (type === 'Sale') return 'Sale price (FCFA)'
  if (type === 'Guest house') return 'Price per night (FCFA)'
  if (type === 'Rent') return budgetPeriod === 'year' ? 'Rent per year (FCFA)' : 'Rent per month (FCFA)'
  return budgetPeriod === 'year' ? 'Budget (FCFA, rent per year)' : 'Budget (FCFA, rent per month)'
}

export function budgetLabel(type, budgetPeriod = 'month') {
  if (type === 'Sale') return 'Max sale price (FCFA)'
  if (type === 'Guest house') return 'Max price per night (FCFA)'
  if (type === 'Rent') return budgetPeriod === 'year' ? 'Max rent per year (FCFA)' : 'Max rent per month (FCFA)'
  return 'Max budget (FCFA)'
}

export function budgetHint(type, budgetPeriod = 'month') {
  if (type === 'Sale') return 'Full purchase price, e.g. 25,000,000'
  if (type === 'Guest house') return 'Cost of one night, e.g. 25,000'
  if (type === 'Rent') return budgetPeriod === 'year' ? 'Rent for a full year, e.g. 1,200,000' : 'Rent for one month, e.g. 150,000'
  return 'Monthly for rentals, nightly for guest houses, full price for sales'
}
