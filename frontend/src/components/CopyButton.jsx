import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// One click copies text (a Seller SKU, a list of them…); a tick shows it worked.
export default function CopyButton({ text, title = 'Copy', label = '', size = 12, style = {} }) {
  const [done, setDone] = useState(false)
  const copy = e => {
    e.stopPropagation()
    const ok = () => { setDone(true); setTimeout(() => setDone(false), 1200) }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, () => fallback(text) && ok())
    else if (fallback(text)) ok()
  }
  return (
    <button type="button" onClick={copy} title={done ? 'Copied' : title} aria-label={title}
      style={{ display:'inline-flex', alignItems:'center', gap:4, padding: label ? '2px 7px' : 3, border:'1px solid #e2e8f0', borderRadius:6, background: done ? '#dcfce7' : '#fff',
        color: done ? '#15803d' : '#64748b', cursor:'pointer', fontSize:11, lineHeight:1, flexShrink:0, ...style }}>
      {done ? <Check size={size} /> : <Copy size={size} />}{label && <span>{done ? 'Copied' : label}</span>}
    </button>
  )
}

// Clipboard API unavailable (http, old browser): a hidden textarea and execCommand.
function fallback(text) {
  try {
    const t = document.createElement('textarea')
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'
    document.body.appendChild(t); t.select()
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  } catch { return false }
}
