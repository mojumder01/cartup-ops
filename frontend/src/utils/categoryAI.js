// Categories for the AI's category check (a Daraz Upload option): the CartUp
// categories that share a product's words, best first — what the AI may pick
// from when a product's category is empty or doesn't fit it. Words in the
// last part of a path ("Umbrellas Rainwear") count more, and words common to
// many categories (women, set, accessories) count less.
import { cartupCategories } from './catalog'

const STOP = new Set(['and', 'for', 'with', 'the', 'new', 'best', 'pcs', 'piece', 'pieces', 'set', 'pack', 'combo', 'free', 'size', 'color', 'colour',
  'high', 'quality', 'original', 'premium', 'other', 'others', 'more', 'item', 'items', 'type', 'style', 'from', 'your', 'all', 'one'])
const stem = w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w
// What a word also says: a phone brand is a phone, a cover is a case.
const ALSO = { iphone: 'phone', samsung: 'phone', xiaomi: 'phone', redmi: 'phone', oppo: 'phone', vivo: 'phone', realme: 'phone', infinix: 'phone',
  tecno: 'phone', huawei: 'phone', oneplus: 'phone', nokia: 'phone', cover: 'case' }
const tokens = s => s.split(/\s+/).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem)
// A text's words in order — "T-Shirt" both as "shirt" and "tshirt".
const ordered = s => {
  const t = String(s || '').toLowerCase()
  return tokens(t.replace(/[^a-z0-9\s]/g, ' ')).concat(tokens(t.replace(/(\w)-(\w)/g, '$1$2').replace(/[^a-z0-9\s]/g, ' ')))
}
export const categoryWords = s => { const w = ordered(s); return [...new Set([...w, ...w.map(x => ALSO[x]).filter(Boolean)])] }
// Who a product is for: a name saying "Men's" prefers Men categories over Women ones.
const GENDER = { men: /\b(men|man|mens|male|gents?)\b/, women: /\b(women|woman|womens|ladies|lady|female)\b/, boys: /\bboys?\b/, girls: /\bgirls?\b/, kids: /\b(kids?|baby|babies|child|children|infant)\b/ }
const genders = s => { const t = String(s).toLowerCase().replace(/[^a-z\s]/g, ' '); return Object.keys(GENDER).filter(g => GENDER[g].test(t)) }
const phrase = s => tokens(String(s).toLowerCase().replace(/(\w)-(\w)/g, '$1$2').replace(/[^a-z0-9\s]/g, ' ')).join(' ')

let index = null, indexed = null   // built once per category list (the team's may change)
function categoryIndex() {
  const cartup_map = cartupCategories()
  if (index && indexed === cartup_map) return index
  indexed = cartup_map
  const cats = Object.entries(cartup_map).map(([id, c]) => ({ id, path: c.path || '', tags: c.tags || '' }))
  const byWord = new Map(), byPhrase = new Map()
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }
  for (const c of cats) {
    const leaf = new Set(categoryWords(c.path.split('>').pop()))
    for (const w of new Set([...categoryWords(c.path), ...categoryWords(c.tags)])) add(byWord, w, [c, leaf.has(w) ? 3 : 1])
    // Two words side by side in a tag or the leaf ("phone case", "face wash") — the same two in a name count extra.
    const pairs = new Set()
    for (const t of [...c.tags.split(','), c.path.split('>').pop()].map(phrase)) { const w = t.split(' '); for (let i = 0; i + 1 < w.length; i++) pairs.add(`${w[i]} ${w[i + 1]}`) }
    for (const t of pairs) add(byPhrase, t, c)
  }
  return (index = { cats, byWord, byPhrase })
}

// → [{ id, path }] — up to `limit` categories sharing the name's words.
export function categoryCandidates(name, limit = 10) {
  const { cats, byWord, byPhrase } = categoryIndex()
  const score = new Map()
  for (const w of categoryWords(name)) {
    const hits = byWord.get(w)
    if (!hits) continue
    const idf = Math.log(cats.length / hits.length)
    for (const [c, s] of hits) score.set(c, (score.get(c) || 0) + s * idf)
  }
  const w = ordered(name).map(x => ALSO[x] && x !== 'cover' ? ALSO[x] : x)
  for (let i = 0; i + 1 < w.length; i++) {
    const hits = byPhrase.get(`${w[i]} ${w[i + 1]}`)
    if (hits) for (const c of hits) score.set(c, (score.get(c) || 0) + 4 * Math.log(cats.length / hits.length))
  }
  const want = genders(name)
  if (want.length) for (const [c, v] of score) {
    const has = genders(c.path.split('>').slice(0, -1).join(' '))
    if (has.some(g => want.includes(g))) score.set(c, v * 1.5)
    else if (has.length) score.set(c, v * 0.6)
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].path.length - b[0].path.length).slice(0, limit).map(([c]) => ({ id: c.id, path: c.path }))
}
