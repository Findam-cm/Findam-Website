export const cities = ['Bamenda', 'Buea', 'Yaounde']

// Neighbourhood centres used as map pins. These are not street addresses.
export const cityCenters = {
  Bamenda: { lat: 5.9597, lng: 10.1461 },
  Buea: { lat: 4.1534, lng: 9.2423 },
  Yaounde: { lat: 3.8667, lng: 11.5167 },
}

export const listings = [
  { id: 1, title: '2 Bedroom Apartment', type: 'Rent', city: 'Bamenda', neighbourhood: 'Bambili', lat: 6.006, lng: 10.255, price: 150000, period: 'month', beds: 2, baths: 2, size: 120, hue: 26, featured: true, description: 'A bright, secure apartment with a fitted kitchen, private parking and reliable water supply.' },
  { id: 2, title: '3 Bedroom Flat', type: 'Rent', city: 'Yaounde', neighbourhood: 'Melen', lat: 3.8645, lng: 11.4968, price: 200000, period: 'month', beds: 3, baths: 2, size: 150, hue: 204, featured: true, description: 'A spacious family flat near the university, with a fenced compound and borehole water.' },
  { id: 3, title: 'Studio Apartment', type: 'Rent', city: 'Buea', neighbourhood: 'Molyko', lat: 4.1538, lng: 9.2875, price: 100000, period: 'month', beds: 1, baths: 1, size: 45, hue: 160, featured: true, description: 'A compact studio for students, within walking distance of Molyko campus.' },
  { id: 4, title: '4 Bedroom Duplex', type: 'Sale', city: 'Yaounde', neighbourhood: 'Odza', lat: 3.8228, lng: 11.5324, price: 350000, period: 'sale', beds: 4, baths: 3, size: 250, hue: 32, featured: true, description: 'A modern duplex on a titled plot, with solar backup, boys quarters and a two-car garage.' },
  { id: 5, title: 'Self-Contain Room', type: 'Rent', city: 'Bamenda', neighbourhood: 'Mankon', lat: 5.9635, lng: 10.1512, price: 45000, period: 'month', beds: 1, baths: 1, size: 25, hue: 88, description: 'An affordable self-contained room close to shops and transport.' },
  { id: 6, title: 'Furnished Guest House', type: 'Guest house', city: 'Buea', neighbourhood: 'Bonduma', lat: 4.1695, lng: 9.2368, price: 25000, period: 'night', beds: 2, baths: 1, size: 90, hue: 140, description: 'A furnished two-bedroom guest house for short stays and weekend getaways.' },
]

export const agents = [
  { name: 'Ekwalla Mbua', city: 'Bamenda', rating: '4.8', closed: 34, initials: 'EM' },
  { name: 'Ngo Bibaine', city: 'Yaounde', rating: '4.9', closed: 27, initials: 'NB' },
  { name: 'Tabi Etone', city: 'Buea', rating: '4.7', closed: 19, initials: 'TE' },
]
