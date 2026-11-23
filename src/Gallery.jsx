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

export default function Gallery({ photos = [], title, hue, taken, overlay }) {
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
    {count > 1 ? <div className="thumbs" role="group" aria-label="Choose a photo">{photos.map((src, i) => <button type="button" key={src} className={i === index ? 'selected' : ''} onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}`} aria-pressed={i === index}><img src={src} alt="" loading="lazy" /></button>)}</div> : null}
    {open ? <Lightbox photos={photos} index={index} setIndex={setIndex} title={title} onClose={() => setOpen(false)} /> : null}
  </div>
}

// Phone photos can be larger than the 5 MB upload limit. Shrink only those, keeping the whole
// picture and its original proportions and orientation.
export async function preparePhoto(file, limit = 4.8 * 1024 * 1024) {
  if (file.size <= limit || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const longest = Math.max(bitmap.width, bitmap.height)
    let scale = Math.min(1, 3200 / longest)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (blob && blob.size <= limit) return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
      scale *= 0.8
    }
  } catch {}
  return file
}
