import { useEffect, useRef, useState } from 'react'
import { L, baseLayers, houseIcon, parseLocation } from './leafletSetup.js'
import { cityCenters } from './data.js'

// Admin-only tool to pin the exact house. Tap the map, drag the pin, use the phone's GPS while
// standing at the house, or paste a Google Maps link.
export default function LocationPicker({ value, onChange, city }) {
  const box = useRef(null)
  const map = useRef(null)
  const marker = useRef(null)
  const layers = useRef(null)
  const [view, setView] = useState('satellite')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  const place = (point, zoom) => {
    const instance = map.current
    if (!instance) return
    if (!marker.current) {
      marker.current = L.marker([point.lat, point.lng], { icon: houseIcon, draggable: true }).addTo(instance)
      marker.current.on('dragend', () => {
        const at = marker.current.getLatLng()
        changeRef.current({ lat: Math.round(at.lat * 1e6) / 1e6, lng: Math.round(at.lng * 1e6) / 1e6 })
      })
    } else {
      marker.current.setLatLng([point.lat, point.lng])
    }
    if (zoom) instance.setView([point.lat, point.lng], zoom)
  }

  useEffect(() => {
    const start = value || cityCenters[city] || { lat: 5.96, lng: 10.15 }
    const instance = L.map(box.current, { scrollWheelZoom: true }).setView([start.lat, start.lng], value ? 18 : 14)
    layers.current = baseLayers()
    layers.current.satellite.addTo(instance)
    instance.on('click', (event) => {
      const point = { lat: Math.round(event.latlng.lat * 1e6) / 1e6, lng: Math.round(event.latlng.lng * 1e6) / 1e6 }
      changeRef.current(point)
    })
    map.current = instance
    if (value) place(value)
    return () => { instance.remove(); map.current = null; marker.current = null }
  }, [])

  useEffect(() => {
    if (value) place(value)
    else if (marker.current) { marker.current.remove(); marker.current = null }
  }, [value?.lat, value?.lng])

  useEffect(() => {
    if (!value && city && cityCenters[city] && map.current) map.current.setView([cityCenters[city].lat, cityCenters[city].lng], 14)
  }, [city])

  const switchView = (next) => {
    if (next === view || !map.current) return
    map.current.removeLayer(layers.current[view])
    layers.current[next].addTo(map.current)
    setView(next)
  }

  const usePasted = () => {
    const parsed = parseLocation(text)
    if (!parsed) return
    if (parsed.error) { setNote(parsed.error); return }
    setNote('Pin placed from the link. Drag it if it needs a small correction.')
    onChange(parsed)
    place(parsed, 18)
  }

  const useGps = () => {
    if (!('geolocation' in navigator)) { setNote('This browser cannot read your location.'); return }
    setNote('Reading your phone’s GPS…')
    navigator.geolocation.getCurrentPosition((position) => {
      const point = { lat: Math.round(position.coords.latitude * 1e6) / 1e6, lng: Math.round(position.coords.longitude * 1e6) / 1e6 }
      onChange(point)
      place(point, 18)
      setNote(`Pin placed at your position (accurate to about ${Math.round(position.coords.accuracy)} m). Drag it onto the roof of the house if needed.`)
    }, () => setNote('Your location could not be read. Allow location access, turn on GPS and try again.'), { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 })
  }

  return <div className="location-picker">
    <div className="picker-tools">
      <div className="segmented" role="group" aria-label="Map style">
        <button type="button" className={view === 'satellite' ? 'selected' : ''} onClick={() => switchView('satellite')}>Satellite</button>
        <button type="button" className={view === 'street' ? 'selected' : ''} onClick={() => switchView('street')}>Map</button>
      </div>
      <button type="button" className="secondary" onClick={useGps}>I am at the house: use my location</button>
    </div>
    <div ref={box} className="picker-canvas" aria-label="Tap the map to place the house pin" />
    <div className="picker-paste">
      <input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); usePasted() } }} placeholder="Or paste a Google Maps link or the location numbers" aria-label="Google Maps link or location numbers" />
      <button type="button" className="secondary" onClick={usePasted}>Place pin</button>
    </div>
    <p className="picker-note">{note || (value ? 'Pin set. Drag it or tap elsewhere to adjust.' : 'Tap the house on the map to drop the pin.')}{value ? <> <button type="button" className="text-button danger" onClick={() => { onChange(null); setNote('Pin removed. The listing will show the neighbourhood only.') }}>Remove pin</button></> : null}</p>
  </div>
}
