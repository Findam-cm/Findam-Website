import { useEffect, useRef, useState } from 'react'
import { L, baseLayers, formatDistance, formatMinutes, houseIcon, youIcon } from './leafletSetup.js'

// Public map for a home with an exact pin. Shows the house and, on request, the route from
// the visitor's current position. It never displays coordinates.
export default function ExactMap({ lat, lng, title }) {
  const box = useRef(null)
  const map = useRef(null)
  const layers = useRef(null)
  const route = useRef(null)
  const [view, setView] = useState('street')
  const [status, setStatus] = useState('')
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    const instance = L.map(box.current, { scrollWheelZoom: false, tap: true }).setView([lat, lng], 17)
    layers.current = baseLayers()
    layers.current.street.addTo(instance)
    L.marker([lat, lng], { icon: houseIcon, keyboard: false, title }).addTo(instance)
    map.current = instance
    const resize = () => instance.invalidateSize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); instance.remove(); map.current = null }
  }, [lat, lng, title])

  const switchView = (next) => {
    const instance = map.current
    if (!instance || next === view) return
    instance.removeLayer(layers.current[view])
    layers.current[next].addTo(instance)
    setView(next)
  }

  const recenter = () => map.current?.setView([lat, lng], 17)

  const directions = () => {
    if (!('geolocation' in navigator)) { setStatus('Your browser cannot share your location.'); return }
    setStatus('Finding your location…')
    setSummary(null)
    navigator.geolocation.getCurrentPosition(async (position) => {
      const from = [position.coords.latitude, position.coords.longitude]
      const instance = map.current
      if (!instance) return
      route.current?.remove()
      const group = L.featureGroup([L.marker(from, { icon: youIcon, title: 'You are here' })])
      try {
        setStatus('Drawing the route…')
        const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${lng},${lat}?overview=full&geometries=geojson`
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
        const payload = await response.json()
        const best = payload.routes?.[0]
        if (!response.ok || !best) throw new Error('no route')
        L.geoJSON(best.geometry, { style: { color: '#ff7119', weight: 6, opacity: 0.9 } }).addTo(group)
        setSummary({ distance: formatDistance(best.distance), drive: formatMinutes(best.duration), walk: formatMinutes(best.distance / 1.25) })
        setStatus('')
      } catch {
        const straight = instance.distance(from, [lat, lng])
        L.polyline([from, [lat, lng]], { color: '#ff7119', weight: 4, dashArray: '8 8' }).addTo(group)
        setSummary({ distance: formatDistance(straight), straight: true })
        setStatus('The road route could not be loaded, so a straight line is shown.')
      }
      group.addTo(instance)
      route.current = group
      instance.fitBounds(group.getBounds().extend([lat, lng]), { padding: [40, 40] })
    }, (error) => {
      setStatus(error.code === 1 ? 'Allow location access in your browser to see directions from where you are.' : 'Your location could not be found. Try again outside or with GPS on.')
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 })
  }

  return <div className="exact-map">
    <div className="exact-map-tools">
      <div className="segmented" role="group" aria-label="Map style">
        <button type="button" className={view === 'street' ? 'selected' : ''} aria-pressed={view === 'street'} onClick={() => switchView('street')}>Map</button>
        <button type="button" className={view === 'satellite' ? 'selected' : ''} aria-pressed={view === 'satellite'} onClick={() => switchView('satellite')}>Satellite</button>
      </div>
      <button type="button" className="secondary" onClick={recenter}>Show the house</button>
      <button type="button" className="primary" onClick={directions}>Directions from my location</button>
    </div>
    <div ref={box} className="exact-map-canvas" role="region" aria-label={`Map showing ${title}`} />
    {summary ? <p className="route-summary"><b>{summary.distance}</b>{summary.straight ? ' in a straight line' : <> by road · about {summary.drive} by car or taxi · about {summary.walk} on foot</>}</p> : null}
    {status ? <p className="map-status" role="status">{status}</p> : null}
  </div>
}
