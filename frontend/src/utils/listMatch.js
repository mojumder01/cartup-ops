// Matching a value to an entry of a CartUp dropdown list (Brand, Color, Size,
// Warranty…). The upload template's hidden payload sheet VLOOKUPs the exact
// entry, so anything not on the list becomes #N/A and the platform rejects the
// row. In order of confidence:
//   exact   — the entry itself (VLOOKUP ignores case, so case-only differences count)
//   format  — same text apart from spacing / punctuation ("Type-B" = "Type B");
//             decimal points and + are kept, so "2.5mm" never becomes "25mm"
//   alias   — a known equivalent: EU:40 → 40 (EU), XXL → 2XL, Free Size → One Size,
//             King → King Size, 6 Months → 6 month, Local seller warranty → Seller Warranty…
//   similar — the same words in another order, or a typo or two — only when one
//             entry is clearly closest and every number in it is the same
// Brands, units and warranty fields never use "similar": a near brand name is a
// different brand.

export const MATCH_LABEL = { exact: 'Exact', format: 'Spacing / punctuation', alias: 'Known equivalent', similar: 'Close spelling' }

const spaced = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
// Letters, digits and + only — except punctuation between two digits, which
// carries meaning ("3-4" ≠ "34", "2.5" ≠ "25").
function squash(s) {
  const t = spaced(s)
  let out = ''
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (/[a-z0-9+]/.test(ch)) { out += ch; continue }
    if (ch === ' ') continue
    let a = i - 1, b = i + 1
    while (t[a] === ' ') a--
    while (t[b] === ' ') b++
    if (/\d/.test(t[a] ?? '') && /\d/.test(t[b] ?? '')) out += ch
  }
  return out
}
const tokens = s => spaced(s).split(/[^a-z0-9.+]+/).filter(Boolean)
const numbers = s => (squash(s).match(/\d+(?:[^a-z0-9+]\d+)*/g) || []).join(',')

// Which rules apply to a column, from its template header.
export function columnKind(header) {
  const h = String(header ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (h.includes('color') || h.includes('colour')) return 'color'
  if (h.includes('warrantyperiod')) return 'warrantyPeriod'
  if (h.includes('warrantytype')) return 'warrantyType'
  if (h === 'unit') return 'unit'
  if (h === 'brand') return 'brand'
  if (h.includes('shoesize')) return 'shoeSize'
  if (h.includes('size') || h.includes('agegroup') || h.includes('recommendedage')) return 'size'
  return 'other'
}

const SYSTEMS = 'eu|uk|us|cn|jp|au|br|fr|it'
const FREE_SIZE = /^(free|free ?size|freesize|fs|f\/s|one ?size|onesize|standard|standard size|universal|universal size)$/
const SIZE_WORDS = {
  'extra small': 'xs', 'x-small': 'xs', xsmall: 'xs', small: 's', medium: 'm', large: 'l',
  'extra large': 'xl', 'x-large': 'xl', xlarge: 'xl', 'double extra large': 'xxl', 'xx-large': 'xxl', xxlarge: 'xxl',
}
const UNITS = {
  pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', nos: 'PCS', no: 'PCS', unit: 'PCS', units: 'PCS', set: 'PCS',
  kg: 'kilogram', kgs: 'kilogram', kilo: 'kilogram', kilograms: 'kilogram',
  g: 'Gram', gm: 'Gram', gms: 'Gram', gram: 'Gram', grams: 'Gram', gr: 'Gram',
  l: 'Litre', ltr: 'Litre', liter: 'Litre', liters: 'Litre', litre: 'Litre', litres: 'Litre',
  pair: 'Pairs', pairs: 'Pairs', m: 'Meter', metre: 'Meter', meter: 'Meter', meters: 'Meter', metres: 'Meter',
  mg: 'Miligrams', milligram: 'Miligrams', milligrams: 'Miligrams', km: 'K.M.', dozen: 'Dozen', dozens: 'Dozen', doz: 'Dozen',
}

function sizeAliases(v, kind) {
  const out = []
  const bare = v.replace(/^(int|international|intl)\s*[:\-.]\s*/, '')
  if (bare !== v) out.push(bare)
  // EU:40, EU 40, 40 EU, 40(EU) → 40 (EU), EU:40, 40
  let m = new RegExp(`^(${SYSTEMS})\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)$`).exec(bare)
  let sys, num
  if (m) { sys = m[1]; num = m[2] } else if ((m = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*\\(?\\s*(${SYSTEMS})\\s*\\)?$`).exec(bare))) { num = m[1]; sys = m[2] }
  if (sys) {
    const S = sys.toUpperCase()
    out.push(`${num} (${S})`, `${S}:${num}`, `${S} ${num}`, num)
  } else if (kind === 'shoeSize' && /^\d+(\.\d+)?$/.test(bare) && +bare >= 30 && +bare <= 50) {
    out.push(`${bare} (EU)`)   // a bare 30–50 shoe size is European; smaller numbers could be UK or US
  }
  if ((m = /^(x{2,6})(s|l)$/.exec(bare))) out.push(`${m[1].length}x${m[2]}`)        // XXL → 2XL
  if ((m = /^([2-6])\s*x\s*(s|l)$/.exec(bare))) out.push('x'.repeat(+m[1]) + m[2])   // 2XL → XXL
  if (SIZE_WORDS[bare]) out.push(SIZE_WORDS[bare])
  if (FREE_SIZE.test(bare)) out.push('one size', 'free size', 'free', 'standard')
  if (/\ssize$/.test(bare)) out.push(bare.replace(/\s*size$/, ''))
  else out.push(`${bare} size`)                                                  // King → King Size
  if (/\b(month|year|day)s?\b/.test(bare)) {
    out.push(bare.replace(/\b(month|year|day)s\b/g, '$1'), bare.replace(/\b(month|year|day)\b/g, '$1s'))
  }
  return out
}

function periodAliases(v) {
  const m = /^(\d+)\s*(d|days?|w|wks?|weeks?|m|mos?|mths?|months?|y|yrs?|years?)$/.exec(v)
  if (!m) return []
  const n = +m[1]
  const unit = m[2][0] === 'd' ? 'day' : m[2][0] === 'w' ? 'week' : m[2][0] === 'y' ? 'year' : 'month'
  const out = [`${n} ${unit}`, `${n} ${unit}s`]
  if (unit === 'month' && n % 12 === 0) out.push(`${n / 12} year`, `${n / 12} years`)
  if (unit === 'year') out.push(`${n * 12} month`, `${n * 12} months`)
  return out
}

function aliases(raw, kind) {
  const v = spaced(raw)
  const out = []
  if (kind === 'color') {
    const c = v.replace(/colour/g, 'color')
    out.push(c, c.replace(/grey/g, 'gray'), c.replace(/gray/g, 'grey'))
    if (/^(multi|multi[ -]?colou?rs?|multiple colou?rs?|mixed?[ -]?colou?rs?|assorted( colou?rs?)?)$/.test(v)) out.push('multicolor', 'multi color', 'multicolour')
    if (/^((as|same as|like) (the )?(picture|pic|image|photo|shown)s?|as shown|picture colou?r|as per (picture|image))$/.test(v)) out.push('same as picture', 'as per image', 'picture color')
    if (/^(not specified|n\/?a|none|default|no colou?r)$/.test(v)) out.push('not specified')
    if (/^random( colou?rs?)?$/.test(v)) out.push('random')
  } else if (kind === 'size' || kind === 'shoeSize') {
    out.push(...sizeAliases(v, kind))
  } else if (kind === 'warrantyPeriod') {
    out.push(...periodAliases(v))
  } else if (kind === 'warrantyType') {
    if (/^(no warranty|none|n\/?a|no)$/.test(v)) out.push('no warranty')
    else if (/seller|shop|store/.test(v)) out.push('seller warranty')
    else if (/brand|manufacturer|agent|official|company/.test(v)) out.push('brand warranty')
  } else if (kind === 'unit') {
    const u = UNITS[v.replace(/[.\s]/g, '')]
    if (u) out.push(u)
  } else if (kind === 'brand') {
    if (/^(no ?brand|non ?brand|generic|unbranded|none|n\/?a)$/.test(v)) out.push('no brand', 'generic')
  }
  return out
}

// Damerau–Levenshtein distance, giving up past `max`.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1)
      cur.push(d)
      rowMin = Math.min(rowMin, d)
    }
    if (rowMin > max) return max + 1
    prev2 = prev; prev = cur
  }
  return prev[b.length]
}

// rows: [[name, …]] — the list as read from the template (first column = name).
export function listMatcher(rows, kind = 'other') {
  const exact = new Map(), lower = new Map(), sp = new Map(), sq = new Map(), tk = new Map()
  for (const r of rows) {
    const n = String(r[0])
    if (n === '') continue
    if (!exact.has(n)) exact.set(n, n)
    const l = n.toLowerCase(); if (!lower.has(l)) lower.set(l, n)
    const s = spaced(n); if (!sp.has(s)) sp.set(s, n)
    const q = squash(n); if (q && !sq.has(q)) sq.set(q, n)
    const t = tokens(n).sort().join(' '); if (t && !tk.has(t)) tk.set(t, n)
  }
  const keys = [...sq.entries()].map(([k, name]) => ({ k, name, nums: numbers(k) }))
  const fuzzy = !['brand', 'unit', 'warrantyType', 'warrantyPeriod'].includes(kind)

  const find = v => {
    if (exact.has(v)) return { value: v, how: 'exact' }
    const l = lower.get(v.toLowerCase())
    if (l !== undefined) return { value: l, how: 'exact' }
    const f = sp.get(spaced(v)) ?? sq.get(squash(v))
    return f !== undefined ? { value: f, how: 'format' } : null
  }
  const similar = v => {
    const t = tk.get(tokens(v).sort().join(' '))
    if (t !== undefined && numbers(t) === numbers(v)) return { value: t, how: 'similar' }   // same words, other order
    const q = squash(v)
    if (q.length < 5) return null
    const max = q.length >= 9 ? 2 : 1
    const nums = numbers(q)
    let best = null, bestD = max + 1, tie = false
    for (const e of keys) {
      if (e.nums !== nums || Math.abs(e.k.length - q.length) > max) continue
      const d = distance(q, e.k, max)
      if (d < bestD) { bestD = d; best = e.name; tie = false } else if (d === bestD) tie = true
    }
    return best !== null && !tie ? { value: best, how: 'similar' } : null
  }

  // For people picking by hand (built on first use — the Color list has 26k entries).
  let entries = null
  // Shared words count only when they have letters — a shared "1" means nothing.
  const words = s => tokens(s).filter(t => /[a-z]{2}/.test(t))
  const allEntries = () => (entries ||= [...exact.keys()].map(name => ({ name, lower: name.toLowerCase(), sq: squash(name), toks: words(name) })))

  const cache = new Map()
  return {
    kind,
    size: exact.size,
    // Closest entries to a value no rule matched safely — shared words,
    // one containing the other, or a few typos — best first.
    suggest(input, limit = 6) {
      const v = String(input ?? '').trim()
      if (!v) return []
      const q = squash(v), vt = new Set(words(v))
      const found = new Map()
      const add = (name, score) => { if (score > (found.get(name) ?? 0)) found.set(name, score) }
      for (const c of aliases(v, kind)) { const f = find(c); if (f) add(f.value, 0.97) }
      for (const e of allEntries()) {
        let s = 0
        if (vt.size) {
          let common = 0
          for (const t of e.toks) if (vt.has(t)) common++
          if (common) s = 0.9 * common / Math.max(vt.size, e.toks.length)
        }
        if (q.length >= 3 && e.sq.length >= 3 && (e.sq.includes(q) || q.includes(e.sq))) {
          s = Math.max(s, 0.5 + 0.4 * Math.min(q.length, e.sq.length) / Math.max(q.length, e.sq.length))
        }
        if (q.length >= 3 && Math.abs(e.sq.length - q.length) <= 3) {
          const d = distance(q, e.sq, 3)
          if (d <= 3) s = Math.max(s, 1 - d / Math.max(q.length, e.sq.length))
        }
        if (s >= 0.4) add(e.name, s)
      }
      return [...found].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name)
    },
    // Type-ahead: entries containing the text, the ones starting with it first.
    search(text, limit = 30) {
      const t = spaced(text)
      if (!t) return []
      const starts = [], contains = []
      for (const e of allEntries()) {
        if (e.lower.startsWith(t)) { if (starts.push(e.name) >= limit) break }
        else if (contains.length < limit && e.lower.includes(t)) contains.push(e.name)
      }
      return [...starts, ...contains].slice(0, limit)
    },
    // → { value, how } or null when nothing on the list is a safe match.
    match(input) {
      const v = String(input ?? '').trim()
      if (v === '') return null
      if (cache.has(v)) return cache.get(v)
      let hit = find(v)
      if (!hit) {
        for (const c of aliases(v, kind)) {
          const f = find(c)
          if (f) { hit = { value: f.value, how: 'alias' }; break }
        }
      }
      if (!hit && fuzzy) hit = similar(v)
      cache.set(v, hit)
      return hit
    },
  }
}

// Rough kind of a variation value, used to tell a colour from a size when a
// Daraz "Variations Combo" lists them in either order.
const COLOR_WORD = /\b(black|white|red|blue|green|yellow|pink|purple|violet|orange|brown|gr[ae]y|silver|golden|gold|navy|maroon|beige|cream|khaki|olive|teal|cyan|magenta|multi ?colou?r|multicolou?r|transparent|clear|rose|peach|coffee|chocolate|ash|off ?white|sky|wine|mint|lavender|turquoise|copper|bronze|charcoal|ivory|mustard|lemon|lime|aqua|indigo|camel|nude|burgundy|skin)\b/
export function valueKind(value) {
  const v = spaced(value).replace(/^(int|international|intl)\s*[:\-.]\s*/, '')
  if (!v) return null
  if (/^(x{0,6}[sml]|[2-6] ?x[sl]|xs|xl)$/.test(v) || FREE_SIZE.test(v) || SIZE_WORDS[v] ||
    new RegExp(`^((${SYSTEMS})\\s*[:\\-]?\\s*\\d+(\\.\\d+)?|\\d+(\\.\\d+)?\\s*\\(?\\s*(${SYSTEMS})\\s*\\)?)$`).test(v) ||
    /^\d+(\.\d+)?\s*(cm|mm|inch|inches|in|"|ft|m)$/.test(v) || /^\d+(\.\d+)?$/.test(v) ||
    /^(uk|us|eu)?:?\d{2}[a-h]{1,3}$/.test(v) || /^(king|queen|single|double|twin|full|super king|semi-double)( size)?$/.test(v) ||
    /^\d+(-\d+)?\+?\s*(months?|years?|m|y)$/.test(v)) return 'size'
  if (COLOR_WORD.test(v)) return 'color'
  return null
}
