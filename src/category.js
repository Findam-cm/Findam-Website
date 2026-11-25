// Home categories and access-pass levels, shared by the website and the Worker.
// A pass level covers its own category and every smaller one:
//   room (10,000)  ->  rooms and self-contained units
//   studio (15,000) -> also studios
//   apartment (20,000) -> also apartments, flats, houses, duplexes, guest houses and homes for sale

export const CATEGORIES = {
  room: { rank: 1, label: 'Room / self-contained', short: 'Room', pass: 'Rooms pass' },
  studio: { rank: 2, label: 'Studio', short: 'Studio', pass: 'Studio pass' },
  apartment: { rank: 3, label: 'Apartment / house', short: 'Apartment', pass: 'Apartment pass' },
}

export const CATEGORY_IDS = Object.keys(CATEGORIES)

// Uses the category the landlord or admin chose; otherwise makes a careful guess from the listing.
export function listingCategory(listing) {
  if (listing && CATEGORIES[listing.category]) return listing.category
  const title = String(listing?.title || '').toLowerCase()
  const text = `${title} ${String(listing?.description || '').toLowerCase()}`
  if (listing?.type === 'Sale' || listing?.type === 'Guest house') return 'apartment'
  // "Studio apartment" is a studio, so check studio before the bigger words.
  if (/\bstudio\b/.test(title)) return 'studio'
  if (/\b(apartment|appartement|flat|duplex|villa|bungalow|house|maison|mansion)\b/.test(title)) return 'apartment'
  // "2 bedrooms", "3-bedroom", "2 bed room" in the title mean an apartment.
  const titleBeds = title.match(/\b(\d+)\s*-?\s*bed\s*-?\s*rooms?\b|\b(\d+)\s*-?\s*bedrooms?\b/)
  if (titleBeds && Number(titleBeds[1] || titleBeds[2]) >= 2) return 'apartment'
  if (Number(listing?.beds) >= 2) return 'apartment'
  if (/\bstudio\b/.test(text)) return 'studio'
  return 'room'
}

export function covers(passTier, category) {
  return (CATEGORIES[passTier]?.rank || 1) >= (CATEGORIES[category]?.rank || 1)
}

export function passFees(env = {}) {
  const pick = (value, fallback) => {
    const n = Math.round(Number(value))
    return Number.isFinite(n) && n >= 50 ? n : fallback
  }
  return {
    room: pick(env.ACCESS_PASS_FCFA, 10000),
    studio: pick(env.ACCESS_PASS_STUDIO_FCFA, 15000),
    apartment: pick(env.ACCESS_PASS_APARTMENT_FCFA, 20000),
  }
}
