import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Pointing at a product image shows it large next to the pointer — on unless
// turned off ("Zoom on hover", remembered in this browser). Images call
// showZoom / hideZoom; one HoverZoomLayer (in Layout) draws the preview.
const KEY = 'image_hover_zoom'
const SIZE = 380
const listeners = new Set()
let current = null   // { src, rect }
const emit = () => listeners.forEach(f => f(current))

export const hoverZoomOn = () => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
export function useHoverZoomSetting() {
  const [on, set] = useState(hoverZoomOn)
  const setOn = v => { try { localStorage.setItem(KEY, v ? 'on' : 'off') } catch { /* storage unavailable */ } set(v); if (!v) hideZoom() }
  return [on, setOn]
}
export const showZoom = (src, el) => { if (!src || !hoverZoomOn()) return; current = { src, rect: el.getBoundingClientRect() }; emit() }
export const hideZoom = () => { if (current) { current = null; emit() } }
// Props for an image: hover to zoom.
export const zoomProps = src => ({ onMouseEnter: e => showZoom(src, e.currentTarget), onMouseLeave: hideZoom })

// The "Zoom on hover" switch.
export function HoverZoomToggle({ style = {} }) {
  const [on, setOn] = useHoverZoomSetting()
  return (
    <label data-hover-zoom style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#475569', cursor:'pointer', whiteSpace:'nowrap', ...style }} title="Point at an image to see it large">
      <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} style={{ accentColor:'#4f46e5' }} /> Zoom on hover
    </label>
  )
}

export function HoverZoomLayer() {
  const [z, setZ] = useState(null)
  const [failed, setFailed] = useState(null)
  useEffect(() => { listeners.add(setZ); return () => { listeners.delete(setZ) } }, [])
  // Scrolling moves the image away from the pointer: close the preview.
  useEffect(() => { if (!z) return; window.addEventListener('scroll', hideZoom, true); return () => window.removeEventListener('scroll', hideZoom, true) }, [z])
  if (!z || failed === z.src) return null
  const { rect } = z, gap = 12, vw = window.innerWidth, vh = window.innerHeight
  const size = Math.min(SIZE, vw - 2 * gap, vh - 2 * gap)
  const left = rect.right + gap + size <= vw ? rect.right + gap : Math.max(gap, rect.left - gap - size)
  const top = Math.min(Math.max(gap, rect.top + rect.height / 2 - size / 2), vh - gap - size)
  return createPortal(
    <div data-zoom-preview style={{ position:'fixed', left, top, width:size, height:size, zIndex:130, pointerEvents:'none', background:'#fff', borderRadius:12,
      boxShadow:'0 12px 40px rgba(15,23,42,0.35)', border:'1px solid #e2e8f0', padding:6, boxSizing:'border-box' }}>
      <img src={z.src} alt="" onError={() => setFailed(z.src)} style={{ width:'100%', height:'100%', objectFit:'contain', borderRadius:8 }} />
    </div>,
    document.body,
  )
}
