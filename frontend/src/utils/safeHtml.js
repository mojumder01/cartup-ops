// Seller HTML (highlights, descriptions) shown in a preview: formatting stays,
// anything that can run code goes — scripts, frames, forms, event handlers
// (onerror=…), javascript: links. Product text comes from sellers, and a page
// of this app holds the login token and the Gemini keys.
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'BASE', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT'])
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'background'])

export function safeHtml(html) {
  if (!html) return ''
  let doc
  try { doc = new DOMParser().parseFromString(`<body>${String(html)}</body>`, 'text/html') } catch { return '' }
  const walk = node => {
    for (const el of [...node.children]) {
      if (DROP.has(el.tagName)) { el.remove(); continue }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase(), value = attr.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
        if (name.startsWith('on') || name === 'style' && /expression|url\(/.test(value)) el.removeAttribute(attr.name)
        else if (URL_ATTRS.has(name) && /^(javascript|vbscript|data:(?!image\/))/.test(value)) el.removeAttribute(attr.name)
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer') }
      walk(el)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}
