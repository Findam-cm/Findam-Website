import { useEffect, useState } from 'react'

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
const CAMEROON = { lat: 5.7, lng: 10.8 }

function placeLabel(city, query) {
  const trimmed = query.trim()
  if (trimmed && city) return `${trimmed}, ${city}, Cameroon`
  if (trimmed) return `${trimmed}, Cameroon`
  if (city) return `${city}, Cameroon`
  return ''
}

function embedSrc(place, origin, mode) {
  const params = new URLSearchParams({ key: MAPS_KEY })
  if (place && origin) {
    params.set('origin', origin)
    params.set('destination', place)
    params.set('mode', mode)
    return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`
  }
  if (place) {
    params.set('q', place)
    return `https://www.google.com/maps/embed/v1/place?${params.toString()}`
  }
  params.set('center', `${CAMEROON.lat},${CAMEROON.lng}`)
  params.set('zoom', '6')
  return `https://www.google.com/maps/embed/v1/view?${params.toString()}`
}

function directionsLink(place, origin, mode) {
  const params = new URLSearchParams({
    api: '1',
    destination: place,
    travelmode: mode,
  })
  if (origin) params.set('origin', origin)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export default function SearchMap({ city, query, compact = false }) {
  const [place, setPlace] = useState(() => placeLabel(city, query))
  const [originInput, setOriginInput] = useState('')
  const [origin, setOrigin] = useState('')
  const [mode, setMode] = useState('driving')

  useEffect(() => {
    const timer = window.setTimeout(() => setPlace(placeLabel(city, query)), 400)
    return () => window.clearTimeout(timer)
  }, [city, query])

  useEffect(() => {
    const timer = window.setTimeout(() => setOrigin(originInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [originInput])

  const heading = compact ? 'Property location' : 'Map of your search'
  const routing = Boolean(place && origin)

  return (
    <section className={`search-map${compact ? ' compact' : ''}${routing ? ' routing' : ''}`} aria-label={heading}>
      <div className="search-map-head">
        <h2>{heading}</h2>
        {MAPS_KEY && routing && <p>Route from {origin} to {place}</p>}
        {MAPS_KEY && place && !routing && <p>Showing {place}</p>}
        {MAPS_KEY && !place && <p>Showing Cameroon</p>}
      </div>
      {MAPS_KEY && place && (
        <form className="route-bar" onSubmit={(event) => { event.preventDefault(); setOrigin(originInput.trim()) }}>
          <label htmlFor={compact ? 'route-origin-property' : 'route-origin-search'}>
            Start from
            <input
              id={compact ? 'route-origin-property' : 'route-origin-search'}
              value={originInput}
              onChange={(event) => setOriginInput(event.target.value)}
              placeholder="e.g. Mile 17, Buea"
              autoComplete="off"
            />
          </label>
          <div className="route-modes" role="group" aria-label="How you are travelling">
            <button type="button" className={mode === 'driving' ? 'selected' : ''} aria-pressed={mode === 'driving'} onClick={() => setMode('driving')}>Driving</button>
            <button type="button" className={mode === 'walking' ? 'selected' : ''} aria-pressed={mode === 'walking'} onClick={() => setMode('walking')}>Walking</button>
          </div>
          <a className="primary route-open" href={directionsLink(place, origin, mode)} target="_blank" rel="noreferrer">Open turn-by-turn</a>
        </form>
      )}
      {MAPS_KEY ? (
        <iframe
          className="search-map-canvas"
          title={routing ? `Directions to ${place}` : heading}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          src={embedSrc(place, origin, mode)}
        />
      ) : (
        <div className="search-map-fallback">
          <p>The map is ready in the page, and it appears here as soon as a Google Maps Embed API key is added.</p>
          <ol>
            <li>In Google Cloud Console, enable the Maps Embed API and turn on billing.</li>
            <li>Create an API key. Restrict it to your website addresses, and allow only the Maps Embed API.</li>
            <li>Copy <code>.env.example</code> to <code>.env</code> in the Findam-Website folder and set <code>VITE_GOOGLE_MAPS_API_KEY</code>.</li>
            <li>Restart the dev server. The key stays in <code>.env</code>, which should not be published.</li>
          </ol>
        </div>
      )}
      <p className="search-map-note">
        {routing
          ? 'The route ends at the neighbourhood centre. Open turn-by-turn for the full drive or walk. Leave the start blank to use your location in Google Maps.'
          : 'Enter where you are coming from to draw the route. The pin is the neighbourhood centre. Map imagery belongs to Google. Listing details belong to FindamCameroon.'}
      </p>
    </section>
  )
}
