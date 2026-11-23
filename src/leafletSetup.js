import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export { L }

export const houseIcon = L.divIcon({
  className: 'house-pin',
  html: '<span class="house-pin-body"><span>⌂</span></span>',
  iconSize: [40, 50],
  iconAnchor: [20, 48],
})

export const youIcon = L.divIcon({ className: 'you-pin', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] })

export function baseLayers() {
  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  })
  const satellite = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
  ])
  return { street, satellite }
}

// Reads a pin from what the admin pastes: "5.9597, 10.1461", a full Google Maps link, or
// degrees/minutes/seconds such as 5°57'34.9"N 10°08'46.0"E.
export function parseLocation(text) {
  const value = String(text || '').trim()
  if (!value) return null
  if (/goo\.gl|maps\.app/i.test(value)) return { error: 'Short share links cannot be read. Open the link, then copy the long address from the browser bar, or press and hold on the house in Google Maps and copy the numbers.' }
  const pick = (re) => { const m = value.match(re); return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null }
  const dms = value.match(/(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([NS])[\s,]+(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([EW])/i)
  if (dms) {
    const lat = (Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600) * (/s/i.test(dms[4]) ? -1 : 1)
    const lng = (Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600) * (/w/i.test(dms[8]) ? -1 : 1)
    return check({ lat, lng })
  }
  const point = pick(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
    || pick(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i)
    || pick(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    || pick(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
  return point ? check(point) : { error: 'That could not be read. Paste two numbers like 5.9597, 10.1461 or a full Google Maps link.' }
}

function check(point) {
  if (point.lat < 1.6 || point.lat > 13.2 || point.lng < 8.3 || point.lng > 16.3) return { error: 'That point is outside Cameroon. Check that the first number is the latitude.' }
  return { lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6 }
}

export function formatDistance(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km` : `${Math.round(metres / 10) * 10} m`
}

export function formatMinutes(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}
