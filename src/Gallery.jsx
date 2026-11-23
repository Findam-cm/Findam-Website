import { useEffect, useRef, useState } from 'react'

// Shows each photo whole, exactly as the camera framed it (portrait or landscape), never cropped.
export function FullPhoto({ src, alt = '', className = '', eager = false }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) return <span className="property-icon" aria-hidden="true">⌂</span>
  return <span className={`photo-frame ${className}`}>
    <img className="photo-backdrop" src={src} alt="" aria-hidden="true" loading={eager ? 'eager' : 'lazy'} />
    <img className="photo-whole" src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
  </span>
}

function useSwipe(onPrev, onNext) {
  const start = useRef(null)
  return {
    onTouchStart: (event) => { const t = event.touches[0]; start.current = { x: t.clientX, y: t.clientY } },
    onTouchEnd: (event) => {
      if (!start.current) return
      const t = event.changedTouches[0]
      const dx = t.clientX - start.current.x
      const dy = t.clientY - start.current.y
      start.current = null
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? onNext : onPrev)()
    },
  }
}

function Lightbox({ photos, index, setIndex, title, onClose }) {
  const count = photos.length
  const prev = () => setIndex((index - 1 + count) % count)
  const next = () => setIndex((index + 1) % count)
  const swipe = useSwipe(prev, next)
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && count > 1) prev()
      if (event.key === 'ArrowRight' && count > 1) next()
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  })
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${title} photos`} onClick={onClose} {...swipe}>
    <div className="lightbox-bar" onClick={(event) => event.stopPropagation()}>
      <span>{index + 1} / {count}</span>
      <button type="button" onClick={onClose} aria-label="Close photos" autoFocus>×</button>
    </div>
    <img className="lightbox-photo" src={photos[index]} alt={`${title}, photo ${index + 1} of ${count}`} onClick={(event) => event.stopPropagation()} />
    {count > 1 ? <>
      <button type="button" className="lightbox-nav prev" aria-label="Previous photo" onClick={(event) => { event.stopPropagation(); prev() }}>‹</button>
      <button type="button" className="lightbox-nav next" aria-label="Next photo" onClick={(event) => { event.stopPropagation(); next() }}>›</button>
    </> : null}
  </div>
}

export default function Gallery({ photos = [], thumbs = [], title, hue, taken, overlay }) {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => { setIndex(0); setOpen(false) }, [photos.join('|')])
  const count = photos.length
  const prev = () => setIndex((index - 1 + count) % count)
  const next = () => setIndex((index + 1) % count)
  const swipe = useSwipe(prev, next)

  if (!count) return <div className={`gallery-stage empty-stage${taken ? ' is-taken' : ''}`} style={{ '--hue': hue }}>{overlay}<span className="property-icon" aria-hidden="true">⌂</span></div>

  return <div className="gallery">
    <div className={`gallery-stage${taken ? ' is-taken' : ''}`} {...swipe}>
      <button type="button" className="stage-open" onClick={() => setOpen(true)} aria-label={`Open photo ${index + 1} of ${count} full screen`}>
        <FullPhoto src={photos[index]} alt={`${title}, photo ${index + 1} of ${count}`} eager />
      </button>
      {overlay}
      {count > 1 ? <>
        <button type="button" className="stage-nav prev" aria-label="Previous photo" onClick={prev}>‹</button>
        <button type="button" className="stage-nav next" aria-label="Next photo" onClick={next}>›</button>
      </> : null}
      <span className="stage-count" aria-hidden="true">{index + 1} / {count}</span>
      <button type="button" className="stage-expand" onClick={() => setOpen(true)}>View full size</button>
    </div>
    {count > 1 ? <div className="thumbs" role="group" aria-label="Choose a photo">{photos.map((src, i) => <button type="button" key={src} className={i === index ? 'selected' : ''} onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}`} aria-pressed={i === index}><img src={thumbs[i] || src} alt="" loading="lazy" /></button>)}</div> : null}
    {open ? <Lightbox photos={photos} index={index} setIndex={setIndex} title={title} onClose={() => setOpen(false)} /> : null}
  </div>
}

async function encode(bitmap, longest, quality, name) {
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  return blob ? new File([blob], name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : null
}

// Makes a web-sized copy (at most 2000 px on the long side) and a small card copy (640 px).
// Both keep the whole picture, its proportions and its upright orientation, so nothing is cropped,
// and visitors on mobile data download a few hundred kilobytes instead of several megabytes.
export async function preparePhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { full: file, thumb: null }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    // Always re-save: this also removes hidden camera data such as the GPS position where the photo was taken.
    const full = await encode(bitmap, 2000, 0.86, file.name)
    const thumb = await encode(bitmap, 640, 0.8, `${file.name}-small`)
    bitmap.close?.()
    return { full: full || file, thumb }
  } catch {
    return { full: file, thumb: null }
  }
}
