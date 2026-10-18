// A small Excel formula engine — just enough to fill the upload template's
// hidden payload sheet the way Excel would. Formulas are tokenized (so they can
// be filled down by shifting their relative references, exactly as Excel's
// fill handle does), parsed, and evaluated for the functions such templates
// use: IF, IFERROR, VLOOKUP, INDEX/MATCH, XLOOKUP, TRIM… Anything else throws
// Unsupported, and the caller leaves that cell for Excel to calculate on open.

export class Unsupported extends Error {}
export const EMPTY = Symbol('empty cell')
export const err = code => ({ error: code })
export const isErr = v => v !== null && typeof v === 'object' && 'error' in v

export function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n }
export function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const MAX_ROW = 1048576, MAX_COL = 16384

// ── Tokenizer ─────────────────────────────────────────────────────────────────
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_¡-￿][\w.¡-￿]*))!`
const END = String.raw`(?![\w.(\[¡-￿])`
const REF_BODY = String.raw`(#REF!|\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?${END}|\$?[A-Z]{1,3}:\$?[A-Z]{1,3}${END}|\$?\d+:\$?\d+${END})`
const RULES = [
  ['ws', /\s+/y],
  ['str', /"(?:[^"]|"")*"/y],
  ['ref', new RegExp(`(?:${SHEET})?${REF_BODY}`, 'y')],
  ['err', /#(?:N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/y],
  ['num', /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y],
  ['id', /(?:_xlfn\.|_xlws\.)?[A-Za-z_\\¡-￿][\w.¡-￿]*/y],
  ['op', /<>|<=|>=|[-+*/^&=<>%]/y],
  ['punc', /[(),]/y],
]

function closeBracket(f, i) {
  let depth = 0
  for (let j = i; j < f.length; j++) {
    if (f[j] === "'") { j++; continue }   // ' escapes the next character in table refs
    if (f[j] === '[') depth++
    else if (f[j] === ']' && --depth === 0) return j + 1
  }
  throw new Unsupported('unbalanced [ ] in formula')
}

function parseRef(m) {
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? null)
  const body = m[3]
  const prefix = m[0].slice(0, m[0].length - body.length)
  if (body === '#REF!') return { sheet, prefix, bad: true }
  let p = /^(\$?)([A-Z]+)(\$?)(\d+)(?::(\$?)([A-Z]+)(\$?)(\d+))?$/.exec(body)
  if (p) {
    return {
      sheet, prefix, kind: 'cells',
      a: { c: colToNum(p[2]), ca: !!p[1], r: +p[4], ra: !!p[3] },
      b: p[5] !== undefined ? { c: colToNum(p[6]), ca: !!p[5], r: +p[8], ra: !!p[7] } : null,
    }
  }
  if ((p = /^(\$?)([A-Z]+):(\$?)([A-Z]+)$/.exec(body))) {
    return { sheet, prefix, kind: 'cols', a: { c: colToNum(p[2]), ca: !!p[1] }, b: { c: colToNum(p[4]), ca: !!p[3] } }
  }
  p = /^(\$?)(\d+):(\$?)(\d+)$/.exec(body)
  return { sheet, prefix, kind: 'rows', a: { r: +p[2], ra: !!p[1] }, b: { r: +p[4], ra: !!p[3] } }
}

export function tokenize(f) {
  const out = []
  let i = 0
  while (i < f.length) {
    if (f[i] === '[') {
      const j = closeBracket(f, i)
      out.push({ type: 'sref', text: f.slice(i, j), table: null, spec: f.slice(i + 1, j - 1) })
      i = j
      continue
    }
    let type, m
    for (const [t, re] of RULES) {
      re.lastIndex = i
      if ((m = re.exec(f))) { type = t; break }
    }
    if (!m) throw new Unsupported(`can't read "${f.slice(i, i + 15)}"`)
    const start = i
    i += m[0].length
    let tok = { type, text: m[0] }
    if (type === 'ref') Object.assign(tok, parseRef(m))
    else if (type === 'id') {
      if (f[i] === '[') {
        const j = closeBracket(f, i)
        tok = { type: 'sref', text: f.slice(start, j), table: m[0], spec: f.slice(i + 1, j - 1) }
        i = j
      } else if (f[i] === '(') tok.type = 'func'
      else if (/^(TRUE|FALSE)$/i.test(m[0])) tok.type = 'bool'
      else tok.type = 'name'
    }
    out.push(tok)
  }
  return out
}

// ── Moving references (fill down / repair) ────────────────────────────────────
function movePoint(p, dr, dc) {
  const o = { ...p }
  if (o.c !== undefined && !o.ca) o.c += dc
  if (o.r !== undefined && !o.ra) o.r += dr
  return o
}
export function refText(tok) {
  if (tok.bad) return `${tok.prefix}#REF!`
  const out = p => ((p.c !== undefined && (p.c < 1 || p.c > MAX_COL)) || (p.r !== undefined && (p.r < 1 || p.r > MAX_ROW)))
  if (out(tok.a) || (tok.b && out(tok.b))) return `${tok.prefix}#REF!`
  const cell = p => `${p.c !== undefined ? `${p.ca ? '$' : ''}${numToCol(p.c)}` : ''}${p.r !== undefined ? `${p.ra ? '$' : ''}${p.r}` : ''}`
  return tok.prefix + cell(tok.a) + (tok.b ? `:${cell(tok.b)}` : '')
}
export function moveRef(tok, dr, dc) {
  return tok.bad ? tok : { ...tok, a: movePoint(tok.a, dr, dc), b: tok.b && movePoint(tok.b, dr, dc) }
}
// The formula as Excel would write it dr rows / dc columns away (copy & paste).
export function shiftFormula(text, dr, dc) {
  return tokenize(text).map(t => t.type === 'ref' ? refText(moveRef(t, dr, dc)) : t.text).join('')
}
// Precomputed fill-down: dr → formula text dr rows below the original.
export function fillDown(tokens) {
  const parts = []
  for (const t of tokens) {
    const moves = t.type === 'ref' && !t.bad && ((t.a.r !== undefined && !t.a.ra) || (t.b?.r !== undefined && !t.b.ra))
    if (moves) parts.push(t)
    else if (typeof parts[parts.length - 1] === 'string') parts[parts.length - 1] += t.text
    else parts.push(t.text)
  }
  return dr => parts.map(p => typeof p === 'string' ? p : refText(moveRef(p, dr, 0))).join('')
}

// ── Parser ────────────────────────────────────────────────────────────────────
export function parse(tokens) {
  const toks = tokens.filter(t => t.type !== 'ws')
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const isOp = ops => peek()?.type === 'op' && ops.includes(peek().text)
  const isPunc = c => peek()?.type === 'punc' && peek().text === c
  const binLevel = (ops, sub) => () => {
    let a = sub()
    while (isOp(ops)) { const op = next().text; a = { t: 'bin', op, a, b: sub() } }
    return a
  }
  const primary = () => {
    const t = next()
    if (!t) throw new Unsupported('formula ends early')
    switch (t.type) {
      case 'num': return { t: 'val', v: Number(t.text) }
      case 'str': return { t: 'val', v: t.text.slice(1, -1).replace(/""/g, '"') }
      case 'bool': return { t: 'val', v: /^true$/i.test(t.text) }
      case 'err': return { t: 'val', v: err(t.text) }
      case 'ref': return { t: 'ref', tok: t }
      case 'sref': return { t: 'sref', tok: t }
      case 'name': return { t: 'name', name: t.text }
      case 'func': {
        const name = t.text.replace(/^_xl(fn|ws)\./i, '').toUpperCase()
        next() // (
        const args = []
        if (isPunc(')')) { next(); return { t: 'fn', name, args } }
        for (;;) {
          args.push(isPunc(',') || isPunc(')') ? { t: 'missing' } : expr())
          const sep = next()
          if (sep?.type === 'punc' && sep.text === ')') break
          if (!(sep?.type === 'punc' && sep.text === ',')) throw new Unsupported(`bad arguments to ${name}()`)
        }
        return { t: 'fn', name, args }
      }
      case 'punc':
        if (t.text === '(') {
          const a = expr()
          if (!isPunc(')')) throw new Unsupported('missing )')
          next()
          return a
        }
    }
    throw new Unsupported(`unexpected "${t.text}"`)
  }
  const postfix = () => { let a = primary(); while (isOp(['%'])) { next(); a = { t: 'pct', a } } return a }
  const unary = () => {
    if (isOp(['-', '+'])) { const op = next().text; const a = unary(); return op === '-' ? { t: 'neg', a } : a }
    return postfix()
  }
  const power = binLevel(['^'], unary)
  const term = binLevel(['*', '/'], power)
  const additive = binLevel(['+', '-'], term)
  const concat = binLevel(['&'], additive)
  const expr = binLevel(['=', '<>', '<', '>', '<=', '>='], concat)
  const ast = expr()
  if (i < toks.length) throw new Unsupported(`unexpected "${toks[i].text}"`)
  return ast
}

// ── Values ────────────────────────────────────────────────────────────────────
// ctx: { sheet (current sheet, lowercase), row, col (the cell being computed),
//        cell(sheet, r, c), maxRow(sheet), maxCol(sheet), table(name), name(name),
//        cache: Map }
export class Range {
  constructor(ctx, sheet, r1, c1, r2, c2) {
    Object.assign(this, { ctx, sheet, r1, c1, r2, c2 })
    this.rows = r2 - r1 + 1
    this.cols = c2 - c1 + 1
  }
  at(i, j) { return this.ctx.cell(this.sheet, this.r1 + i, this.c1 + j) }
}

function scalar(v, ctx) {
  if (!(v instanceof Range)) return v
  if (v.rows === 1 && v.cols === 1) return v.at(0, 0)
  // Implicit intersection with the formula's own row / column.
  if (v.cols === 1 && ctx.row >= v.r1 && ctx.row <= v.r2) return v.ctx.cell(v.sheet, ctx.row, v.c1)
  if (v.rows === 1 && ctx.col >= v.c1 && ctx.col <= v.c2) return v.ctx.cell(v.sheet, v.r1, ctx.col)
  return err('#VALUE!')
}
// The value Excel stores for a formula's result.
export function finalValue(v, ctx) {
  v = scalar(v, ctx)
  if (v === EMPTY) return 0
  if (typeof v === 'number' && !Number.isFinite(v)) return err('#NUM!')
  return v
}
function toNum(v) {
  if (typeof v === 'number' || isErr(v)) return v
  if (v === EMPTY) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  const s = String(v).trim()
  return s !== '' && !Number.isNaN(Number(s)) ? Number(s) : err('#VALUE!')
}
function toText(v) {
  if (isErr(v)) return v
  if (v === EMPTY) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(Number(v.toPrecision(15))).toUpperCase()
  return v
}
function toBool(v) {
  if (typeof v === 'boolean' || isErr(v)) return v
  if (typeof v === 'number') return v !== 0
  if (v === EMPTY) return false
  return /^true$/i.test(v) ? true : /^false$/i.test(v) ? false : err('#VALUE!')
}
// Excel ordering: numbers < text < logicals; text compares case-insensitively.
function compare(a, b) {
  if (isErr(a)) return a
  if (isErr(b)) return b
  const blankAs = o => typeof o === 'number' ? 0 : typeof o === 'boolean' ? false : ''
  if (a === EMPTY) a = blankAs(b)
  if (b === EMPTY) b = blankAs(a)
  const rank = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1
  if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase() }
  return a < b ? -1 : a > b ? 1 : 0
}
function binary(op, a, b) {
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    const c = compare(a, b)
    if (isErr(c)) return c
    return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op]
  }
  if (op === '&') {
    const x = toText(a), y = toText(b)
    return isErr(x) ? x : isErr(y) ? y : x + y
  }
  const x = toNum(a), y = toNum(b)
  if (isErr(x)) return x
  if (isErr(y)) return y
  switch (op) {
    case '+': return x + y
    case '-': return x - y
    case '*': return x * y
    case '/': return y === 0 ? err('#DIV/0!') : x / y
    default: return x ** y
  }
}

// ── References ────────────────────────────────────────────────────────────────
function refRange(tok, ctx, dr) {
  if (tok.bad) return err('#REF!')
  const sheet = tok.sheet ? tok.sheet.toLowerCase() : ctx.sheet
  const R = p => p.ra ? p.r : p.r + dr
  let r1, c1, r2, c2
  if (tok.kind === 'cells') {
    r1 = R(tok.a); c1 = tok.a.c
    r2 = tok.b ? R(tok.b) : r1; c2 = tok.b ? tok.b.c : c1
  } else if (tok.kind === 'cols') {
    r1 = 1; r2 = Math.max(1, ctx.maxRow(sheet)); c1 = tok.a.c; c2 = tok.b.c
  } else {
    c1 = 1; c2 = Math.max(1, ctx.maxCol(sheet)); r1 = R(tok.a); r2 = R(tok.b)
  }
  if (r1 < 1 || r2 < 1 || r1 > MAX_ROW || r2 > MAX_ROW) return err('#REF!')
  return new Range(ctx, sheet, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2))
}

// Table[#All], Table[Col], Table[[#Data],[Col1]:[Col2]], Table[] …
function specItems(spec) {
  const s = spec.trim()
  const unesc = x => x.replace(/'(.)/g, '$1').trim()
  if (!s) return []
  if (!s.startsWith('[')) return [s.startsWith('#') ? { special: s.toLowerCase() } : { from: unesc(s), to: unesc(s) }]
  const items = []
  for (const m of s.matchAll(/\[((?:[^\]']|'.)*)\](?:\s*:\s*\[((?:[^\]']|'.)*)\])?/g)) {
    const a = unesc(m[1])
    items.push(a.startsWith('#') && m[2] === undefined ? { special: a.toLowerCase() } : { from: a, to: unesc(m[2] ?? m[1]) })
  }
  return items
}
function tableRange(tok, ctx) {
  const tbl = tok.table && ctx.table(tok.table)
  if (!tbl) {
    if (tok.table) return err('#REF!')
    throw new Unsupported('[@…] table references')
  }
  const items = specItems(tok.spec)
  const specials = items.filter(x => x.special).map(x => x.special)
  if (specials.some(s => s.startsWith('#this') || s.startsWith('@')) || items.some(x => x.from?.startsWith('@'))) {
    throw new Unsupported('this-row table references')
  }
  const dataR1 = tbl.r1 + tbl.header, dataR2 = tbl.r2 - tbl.totals
  let r1 = dataR1, r2 = dataR2
  if (specials.includes('#all')) { r1 = tbl.r1; r2 = tbl.r2 }
  else if (specials.length) {
    const spans = specials.map(s => s === '#headers' ? [tbl.r1, tbl.r1 + tbl.header - 1]
      : s === '#totals' ? [tbl.r2 - tbl.totals + 1, tbl.r2] : [dataR1, dataR2])
    r1 = Math.min(...spans.map(x => x[0])); r2 = Math.max(...spans.map(x => x[1]))
  }
  let c1 = tbl.c1, c2 = tbl.c2
  const cols = items.find(x => x.from)
  if (cols) {
    const idx = n => tbl.columns.findIndex(c => c.toLowerCase() === n.toLowerCase())
    const a = idx(cols.from), b = idx(cols.to)
    if (a < 0 || b < 0) return err('#REF!')
    c1 = tbl.c1 + Math.min(a, b); c2 = tbl.c1 + Math.max(a, b)
  }
  if (r2 < r1) return err('#REF!')
  return new Range(ctx, tbl.sheet, r1, c1, r2, c2)
}

// ── Lookups ───────────────────────────────────────────────────────────────────
const lookupKey = v => typeof v === 'number' ? `n${v}` : typeof v === 'string' ? `s${v.toLowerCase()}` : typeof v === 'boolean' ? `b${v}` : null
function wildcard(s) {
  let re = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '~' && i + 1 < s.length) re += s[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (ch === '*') re += '[\\s\\S]*'
    else if (ch === '?') re += '[\\s\\S]'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}
// One line of a range (a column, or a row when the range is one row high).
function line(range, k = 0) {
  return range.cols === 1 || range.rows > 1
    ? { n: range.rows, at: i => range.at(i, k), key: `${range.sheet}|${range.r1}|${range.r2}|${range.c1 + k}|c` }
    : { n: range.cols, at: i => range.at(k, i), key: `${range.sheet}|${range.c1}|${range.c2}|${range.r1 + k}|r` }
}
// Exact, case-insensitive, first match — with * ? ~ wildcards for text, as in Excel.
function exactFind(ln, v, ctx) {
  if (typeof v === 'string' && /[*?~]/.test(v)) {
    const re = wildcard(v)
    for (let i = 0; i < ln.n; i++) { const x = ln.at(i); if (typeof x === 'string' && re.test(x)) return i }
    return -1
  }
  let index = ctx.cache.get(ln.key)
  if (!index) {
    index = new Map()
    for (let i = 0; i < ln.n; i++) {
      const k = lookupKey(ln.at(i))
      if (k !== null && !index.has(k)) index.set(k, i)
    }
    ctx.cache.set(ln.key, index)
  }
  const k = lookupKey(v)
  return k === null ? -1 : (index.get(k) ?? -1)
}
// Sorted lookup: the last value <= v (desc: the last value >= v).
function approxFind(ln, v, desc = false) {
  let best = -1
  for (let i = 0; i < ln.n; i++) {
    const x = ln.at(i)
    if (x === EMPTY || isErr(x) || typeof x !== typeof v) continue
    const c = compare(x, v)
    if (desc ? c >= 0 : c <= 0) best = i
    else break
  }
  return best
}

// ── Functions ─────────────────────────────────────────────────────────────────
function* flat(v) {
  if (v instanceof Range) { for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) yield v.at(i, j) }
  else yield v
}
const firstErr = (...vs) => vs.find(isErr)
const given = (a, i) => a[i] && a[i].t !== 'missing'
const textFn = f => (a, ev, S) => { const s = toText(S(a[0])); return isErr(s) ? s : f(s) }

const FN = {
  IF: (a, ev, S) => {
    const c = toBool(S(a[0]))
    if (isErr(c)) return c
    const n = c ? a[1] : a[2]
    return n ? ev(n) : c
  },
  NA: () => err('#N/A'),
  IFERROR: (a, ev, S) => { const v = S(a[0]); return isErr(v) ? ev(a[1]) : v },
  IFNA: (a, ev, S) => { const v = S(a[0]); return isErr(v) && v.error === '#N/A' ? ev(a[1]) : v },
  IFS: (a, ev, S) => {
    for (let i = 0; i + 1 < a.length; i += 2) {
      const c = toBool(S(a[i]))
      if (isErr(c)) return c
      if (c) return ev(a[i + 1])
    }
    return err('#N/A')
  },
  AND: (a, ev) => logical(a, ev, true),
  OR: (a, ev) => logical(a, ev, false),
  NOT: (a, ev, S) => { const b = toBool(S(a[0])); return isErr(b) ? b : !b },
  ISBLANK: (a, ev, S) => S(a[0]) === EMPTY,
  ISERROR: (a, ev, S) => isErr(S(a[0])),
  ISERR: (a, ev, S) => { const v = S(a[0]); return isErr(v) && v.error !== '#N/A' },
  ISNA: (a, ev, S) => { const v = S(a[0]); return isErr(v) && v.error === '#N/A' },
  ISNUMBER: (a, ev, S) => typeof S(a[0]) === 'number',
  ISTEXT: (a, ev, S) => typeof S(a[0]) === 'string',
  ISLOGICAL: (a, ev, S) => typeof S(a[0]) === 'boolean',
  TRIM: textFn(s => s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')),
  CLEAN: textFn(s => s.replace(/[\x00-\x1f]/g, '')),
  LOWER: textFn(s => s.toLowerCase()),
  UPPER: textFn(s => s.toUpperCase()),
  LEN: textFn(s => s.length),
  T: (a, ev, S) => { const v = S(a[0]); return typeof v === 'string' || isErr(v) ? v : '' },
  LEFT: (a, ev, S) => substr(a, S, (s, n) => s.slice(0, n)),
  RIGHT: (a, ev, S) => substr(a, S, (s, n) => n > 0 ? s.slice(-n) : ''),
  MID: (a, ev, S) => {
    const s = toText(S(a[0])), st = toNum(S(a[1])), n = toNum(S(a[2]))
    return firstErr(s, st, n) || (st < 1 || n < 0 ? err('#VALUE!') : s.substr(Math.trunc(st) - 1, Math.trunc(n)))
  },
  SUBSTITUTE: (a, ev, S) => {
    const s = toText(S(a[0])), o = toText(S(a[1])), n = toText(S(a[2]))
    const inst = given(a, 3) ? toNum(S(a[3])) : null
    const e = firstErr(s, o, n, inst)
    if (e) return e
    if (!o) return s
    if (inst === null) return s.split(o).join(n)
    let at = -1
    for (let k = 0; k < inst; k++) { at = s.indexOf(o, at + 1); if (at < 0) return s }
    return s.slice(0, at) + n + s.slice(at + o.length)
  },
  CONCATENATE: (a, ev, S) => {
    const parts = a.map(n => toText(S(n)))
    return firstErr(...parts) || parts.join('')
  },
  CONCAT: (a, ev) => {
    const parts = a.flatMap(n => [...flat(ev(n))]).map(toText)
    return firstErr(...parts) || parts.join('')
  },
  VALUE: (a, ev, S) => toNum(S(a[0])),
  N: (a, ev, S) => { const v = S(a[0]); return typeof v === 'number' || isErr(v) ? v : typeof v === 'boolean' ? +v : 0 },
  ROUND: (a, ev, S) => {
    const x = toNum(S(a[0])), d = toNum(S(a[1]))
    if (firstErr(x, d)) return firstErr(x, d)
    const f = 10 ** Math.trunc(d)
    return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f
  },
  INT: (a, ev, S) => { const x = toNum(S(a[0])); return isErr(x) ? x : Math.floor(x) },
  ABS: (a, ev, S) => { const x = toNum(S(a[0])); return isErr(x) ? x : Math.abs(x) },
  SUM: (a, ev) => {
    let s = 0
    for (const n of a) {
      const v = ev(n)
      if (v instanceof Range) { for (const x of flat(v)) { if (isErr(x)) return x; if (typeof x === 'number') s += x } }
      else { const x = toNum(v); if (isErr(x)) return x; s += x }
    }
    return s
  },
  ROW: (a, ev, S, ctx) => { if (!a.length) return ctx.row; const r = ev(a[0]); return r instanceof Range ? r.r1 : err('#VALUE!') },
  COLUMN: (a, ev, S, ctx) => { if (!a.length) return ctx.col; const r = ev(a[0]); return r instanceof Range ? r.c1 : err('#VALUE!') },
  SINGLE: (a, ev, S) => S(a[0]),
  VLOOKUP: (a, ev, S, ctx) => {
    const v = S(a[0]), range = ev(a[1]), idx = toNum(S(a[2]))
    const approx = a.length < 4 ? true : given(a, 3) ? toBool(S(a[3])) : false
    const e = firstErr(v, range, idx, approx)
    if (e) return e
    if (!(range instanceof Range)) return err('#N/A')
    const col = Math.trunc(idx)
    if (col < 1) return err('#VALUE!')
    if (col > range.cols) return err('#REF!')
    const ln = { n: range.rows, at: i => range.at(i, 0), key: `${range.sheet}|${range.r1}|${range.r2}|${range.c1}|c` }
    const i = approx ? approxFind(ln, v) : exactFind(ln, v, ctx)
    return i < 0 ? err('#N/A') : range.at(i, col - 1)
  },
  MATCH: (a, ev, S, ctx) => {
    const v = S(a[0]), range = ev(a[1]), type = given(a, 2) ? toNum(S(a[2])) : 1
    const e = firstErr(v, range, type)
    if (e) return e
    if (!(range instanceof Range) || (range.rows > 1 && range.cols > 1)) return err('#N/A')
    const ln = line(range)
    const i = type === 0 ? exactFind(ln, v, ctx) : approxFind(ln, v, type < 0)
    return i < 0 ? err('#N/A') : i + 1
  },
  INDEX: (a, ev, S) => {
    const range = ev(a[0])
    if (isErr(range)) return range
    if (!(range instanceof Range)) return err('#VALUE!')
    let r = given(a, 1) ? toNum(S(a[1])) : 0, c = given(a, 2) ? toNum(S(a[2])) : 0
    const e = firstErr(r, c)
    if (e) return e
    if (range.rows === 1 && !given(a, 2) && range.cols > 1) { c = r; r = 1 }
    r = Math.trunc(r); c = Math.trunc(c)
    if (r < 0 || c < 0 || r > range.rows || c > range.cols) return err('#REF!')
    if (range.cols === 1 && c === 0) c = 1
    if (range.rows === 1 && r === 0) r = 1
    if (r === 0) return new Range(range.ctx, range.sheet, range.r1, range.c1 + c - 1, range.r2, range.c1 + c - 1)
    if (c === 0) return new Range(range.ctx, range.sheet, range.r1 + r - 1, range.c1, range.r1 + r - 1, range.c2)
    return range.at(r - 1, c - 1)
  },
  XLOOKUP: (a, ev, S, ctx) => {
    const v = S(a[0]), la = ev(a[1]), ra = ev(a[2])
    const mode = given(a, 4) ? toNum(S(a[4])) : 0, search = given(a, 5) ? toNum(S(a[5])) : 1
    const e = firstErr(v, la, ra, mode, search)
    if (e) return e
    if (!(la instanceof Range) || !(ra instanceof Range)) return err('#VALUE!')
    if (mode !== 0 || Math.abs(search) !== 1) throw new Unsupported('XLOOKUP match/search modes')
    const ln = line(la)
    let i = -1
    if (search === 1) i = exactFind(ln, v, ctx)
    else for (let k = ln.n - 1; k >= 0 && i < 0; k--) if (lookupKey(ln.at(k)) === lookupKey(v)) i = k
    if (i < 0) return given(a, 3) ? ev(a[3]) : err('#N/A')
    if (ra.cols === 1 || ra.rows > 1) return ra.cols === 1 ? ra.at(i, 0) : new Range(ra.ctx, ra.sheet, ra.r1 + i, ra.c1, ra.r1 + i, ra.c2)
    return ra.at(0, i)
  },
}
function logical(a, ev, isAnd) {
  let out = isAnd
  for (const n of a) {
    for (const x of flat(ev(n))) {
      if (x === EMPTY || typeof x === 'string') continue
      const b = toBool(x)
      if (isErr(b)) return b
      out = isAnd ? out && b : out || b
    }
  }
  return out
}
function substr(a, S, f) {
  const s = toText(S(a[0]))
  const n = a.length > 1 ? toNum(S(a[1])) : 1
  const e = firstErr(s, n)
  return e || (n < 0 ? err('#VALUE!') : f(s, Math.trunc(n)))
}

// ── Evaluation ────────────────────────────────────────────────────────────────
// dr shifts the formula's relative row references — the AST is parsed once
// from one row's formula and evaluated for every row it is filled down to.
export function evaluate(node, ctx, dr = 0) {
  const ev = n => evaluate(n, ctx, dr)
  const S = n => scalar(ev(n), ctx)
  switch (node.t) {
    case 'val': return node.v
    case 'missing': return EMPTY
    case 'ref': return refRange(node.tok, ctx, dr)
    case 'sref': return tableRange(node.tok, ctx)
    case 'name': {
      const def = ctx.name(node.name)
      if (def) return evaluate(def, ctx, 0)
      if (ctx.table(node.name)) return tableRange({ table: node.name, spec: '' }, ctx)
      return err('#NAME?')
    }
    case 'neg': { const v = toNum(S(node.a)); return isErr(v) ? v : -v }
    case 'pct': { const v = toNum(S(node.a)); return isErr(v) ? v : v / 100 }
    case 'bin': return binary(node.op, S(node.a), S(node.b))
    case 'fn': {
      const f = FN[node.name]
      if (!f) throw new Unsupported(`${node.name}()`)
      return f(node.args, ev, S, ctx)
    }
  }
  throw new Unsupported('formula')
}
