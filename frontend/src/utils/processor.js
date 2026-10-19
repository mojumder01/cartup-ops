import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import MAPPINGS from './mappings.json'
import { processProductsBatch, localFixName, runConcurrent } from './gemini'
import { applyReplacements } from './wordReplacements'
import { loadTemplate, writeTemplate, chunkRows, zipFiles } from './shopDuplicate'
import { colToNum, numToCol } from './xlsxFormula'
import { IMAGE_COLS } from './checks'
import { todayISO } from './dates'
import { listMatcher, columnKind } from './listMatch'
import { darazRows, cell } from './darazFiles'
import { COMBO_TARGETS, headerKey, colLabel, splitCombo, planParent, placeParts, makeCell, harmonizeSizes, separateCollisions, applyDecisions } from './variantReview'

const { daraz_to_cartup, cartup_map, cat_variant_map, mystery_cats, manual_cats } = MAPPINGS

// The CartUp upload template's columns, in its order — for a file made without
// the template (with it, the template itself is filled). [section, headers];
// a header that isn't one of ours (Storage, Free Items) stays empty, never dropped.
const TEMPLATE_LAYOUT = [
  ['Basic Information', ['**Category Id', '**Name (English)', 'Name (Bengali)', '**Product Image 1', 'Product Image 2', 'Product Image 3', 'Product Image 4',
    'Product Image 5', 'Product Image 6', 'Product Image 7', 'Product Image 8', 'VideoUrl', '**Brand', '**Unit', 'Tags']],
  ['Product Attribute', ['Clothing Materials', 'Shoe Material', 'Bag Material', 'Dial Materials', 'Strap Materials', 'Recommended Age', 'Watch Type',
    'Main Materials', 'ISBN/ISSN', 'Storage', 'Storage']],
  ['Product Description', ['Highlights(English)', 'Highlights(Bengali)', 'Description (Bengali)', 'Description (English)', "What's in the box"]],
  ['Service', ['Warranty Policy(English)', 'Warranty Policy(Bangla)', 'Warranty Type', 'Warranty Period']],
  ['Delivery', ['**Package Weight (kg)', '**Package Length(cm)', '*Package Width (cm)', '*Package Height(cm)']],
  ['Variant Attribute', ['Clothing Size', 'Color', 'Model', 'Age Group', 'Size', 'Shoe Size', 'Bedding Size', '**Seller SKU', '**Parent Sku', '*Variant Image',
    '**Current Stock Qty', '**Price(MRP)', 'Special Price', 'Special Start Date', 'Special End Date', 'Free Items']],
  ['Extra', ['Report', 'Check', 'Cartup Category Path', 'Variations Combo', 'status']],
]
// Template headers named differently from our columns (by headerKey).
const TEMPLATE_KEY = { specialpricestartdate: 'specialstartdate', specialpriceenddate: 'specialenddate' }

export const OUTPUT_COLS = [
  '**Category Id','**Name (English)','Name (Bengali)',
  '**Product Image 1','Product Image 2','Product Image 3','Product Image 4',
  'Product Image 5','Product Image 6','Product Image 7','Product Image 8',
  'VideoUrl','**Brand','**Unit','Tags',
  'Clothing Materials','Shoe Material','Bag Material','Dial Materials',
  'Strap Materials','Recommended Age','Watch Type','Main Materials','ISBN/ISSN',
  'Highlights(English)','Highlights(Bengali)','Description (Bengali)','Description (English)',"What's in the box",
  'Warranty Policy(English)','Warranty Policy(Bangla)','Warranty Type','Warranty Period',
  '**Package Weight (kg)','**Package Length(cm)','*Package Width (cm)','*Package Height(cm)',
  'Clothing Size','Color','Model','Age Group','Size','Shoe Size','Bedding Size',
  '**Seller SKU','**Parent Sku','*Variant Image','**Current Stock Qty',
  '**Price(MRP)','Special Price','Special Price Start Date','Special Price End Date',
  'status','Cartup Category Path','Variations Combo','Report','Check'
]
// Template header key → our column.
const OUR_COL = Object.fromEntries(OUTPUT_COLS.map(c => [TEMPLATE_KEY[headerKey(c)] ?? headerKey(c), c]))
// Our columns by the template's sections (for the sheet view): [{ name, cols }].
export const COLUMN_SECTIONS = [
  ...TEMPLATE_LAYOUT.filter(([name]) => name !== 'Extra').map(([name, heads]) => ({ name, cols: heads.map(h => OUR_COL[headerKey(h)]).filter(Boolean) })),
  { name: 'Extra', cols: ['Cartup Category Path', 'Variations Combo', 'status'] },
]

// Daraz HTML → only the allowed tags, without their attributes (Daraz writes
// <li style="…">, <ul class="…">); every other tag goes, its text stays.
const BREAKS = new Set(['br', 'div', 'p', 'li', 'ul', 'ol', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table'])
function cleanHtml(html, allowedTags) {
  if (!html) return ''
  const allowed = new Set(allowedTags)
  return String(html)
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, name) => {
      name = name.toLowerCase()
      if (allowed.has(name)) return tag[1] === '/' ? `</${name}>` : `<${name}>`
      return BREAKS.has(name) ? ' ' : ''
    })
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/<(li|p)>\s*<\/\1>/gi, '')
    .trim()
}
// Text of some HTML with its line breaks kept (for turning loose text into bullets).
const htmlLines = html => String(html)
  .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .split(/\n|•/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

function cleanHighlights(html) {
  if (!html) return ''
  const clean = cleanHtml(html, ['ul','li'])
  if (/<li>/.test(clean)) return /^<ul>/.test(clean) ? clean : `<ul>${clean.replace(/<\/?ul>/g, '')}</ul>`
  const lines = htmlLines(html)
  return lines.length ? '<ul>' + lines.map(l => `<li>${l}</li>`).join('') + '</ul>' : ''
}

function cleanDescription(html) {
  if (!html) return ''
  const clean = cleanHtml(html, ['p'])
  if (/<p>/.test(clean)) return clean
  const lines = htmlLines(html)
  return lines.length ? lines.map(l => `<p>${l}</p>`).join('') : ''
}

// Content without AI (or when the AI couldn't do a product): spelling rules
// for the name; highlights / description made from each other or the name
// when one is empty.
function localContent({ name, highlights, description }) {
  name = localFixName(name)
  if (!highlights && !description) {
    highlights  = `<ul><li>${name}</li></ul>`
    description = `<p>${name}</p>`
  } else if (!highlights) {
    const text = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    highlights = `<ul><li>${name}</li><li>${text.slice(0, 200)}</li></ul>`
  } else if (!description) {
    const text = highlights.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    description = `<p>${name}. ${text.slice(0, 300)}</p>`
  }
  return { name, highlights, description }
}

// The CartUp upload template's dropdown lists (Color, Size, Brand, Warranty…)
// — what the hidden payload sheet looks values up in; a value not on its list
// shows #N/A there and the upload rejects the row. header key → listMatcher.
// Read once per file (the file check reads it when it is picked).
const listsCache = new WeakMap()
export function templateLists(file) {
  if (!listsCache.has(file)) {
    listsCache.set(file, (async () => {
      const tpl = await loadTemplate(await file.arrayBuffer())
      const lists = {}
      for (const c of tpl.columns) if (c.lookup) lists[headerKey(c.header)] = listMatcher(c.lookup.rows, columnKind(c.header))
      return lists
    })().catch(e => { listsCache.delete(file); throw e }))
  }
  return listsCache.get(file)
}

// Stage 1 (slow, once): read the Daraz files, AI content + categories → one
// item per Seller SKU with its raw values. Stage 2 (matchItems) checks the
// dropdown values against a template's lists and can be repeated with a newer
// template; stage 3 (buildOutput) applies decisions, rules and hand edits.
// options.activeOnly: only rows whose status is "active".
export async function processDarazFiles(files, apiKey, onProgress, options = {}) {
  // options.aiFields: { name, highlights, description } — false: the name gets
  // the spelling rules only; highlights / description are taken from the Basic
  // file as they are (a plain lookup, no clean-up). All off: no AI requests.
  // Categories never use the AI: the mapping table, or a note in Report.
  const aiFields = { name: options.aiFields?.name !== false, highlights: options.aiFields?.highlights !== false, description: options.aiFields?.description !== false }
  const aiName = aiFields.name, aiContent = aiFields.name || aiFields.highlights || aiFields.description
  onProgress('Reading files...')

  const [allPriceRows, basicRows, freightRows, skuimgRows] = await Promise.all([
    darazRows(files.price, 'price'),
    darazRows(files.basic, 'basic'),
    darazRows(files.weight, 'weight'),
    darazRows(files.skuimg, 'skuimg'),
  ])
  const priceRows = options.activeOnly
    ? allPriceRows.filter(r => String(r['status'] || '').trim().toLowerCase() === 'active')
    : allPriceRows
  const skipped = allPriceRows.length - priceRows.length

  let lists = null
  if (files.template) {
    onProgress('Reading the CartUp template\'s lists...')
    lists = await templateLists(files.template)
  }

  const brandDict = {}, isbnDict = {}
  if (files.attr) {
    for (const { pid, brand, isbn } of await darazRows(files.attr, 'attr')) {
      if (pid && !brandDict[pid]) brandDict[pid] = brand || 'No Brand'
      if (pid && isbn && !isbnDict[pid]) isbnDict[pid] = isbn
    }
  }

  // Build lookup dicts
  const basicDict = {}
  for (const r of basicRows) {
    const pid = String(r['Product ID'] || '').trim()
    if (pid && !basicDict[pid]) basicDict[pid] = r
  }
  // Weight rows are per product; a Weight file with a SellerSKU column gives each SKU its own.
  const freightDict = {}, freightBySku = {}
  for (const r of freightRows) {
    const pid = String(r['Product ID'] || '').trim(), sku = String(r['SellerSKU'] || '').trim()
    if (pid && !freightDict[pid]) freightDict[pid] = r
    if (sku && !freightBySku[sku]) freightBySku[sku] = r
  }
  const skuDict = {}
  for (const r of skuimgRows) {
    const sku = String(r['SellerSKU'] || '').trim()
    if (sku && !skuDict[sku]) skuDict[sku] = r
  }

  const BATCH_SIZE = 5

  // ── Step 1: Collect unique PIDs and their content ──────────────────────────
  const uniquePids = {}
  for (const row of priceRows) {
    const pid  = String(row['Product ID'] || '').trim()
    const name = String(row['*Product Name(English)'] || '').trim()
    if (pid && !uniquePids[pid]) {
      const b = basicDict[pid] || {}
      const rawHighlights = String(b['*Highlights'] || b['Highlights'] || ''), rawDescription = String(b['Main Description'] || '')
      uniquePids[pid] = {
        pid,
        name,
        highlights:  cleanHighlights(rawHighlights),
        description: cleanDescription(rawDescription),
        rawHighlights, rawDescription,
      }
    }
  }
  const pidList = Object.values(uniquePids)

  // ── Step 2: AI — batch process unique PIDs (5 per call, CONCURRENCY parallel) ─
  const aiCache = {}   // pid → {name, highlights, description}
  // Products the AI couldn't do (limit reached, bad response…) get the local
  // spelling fix only — counted so the page can say so.
  const aiMissed = new Set()
  let aiMessage = ''
  const aiFailed = (message, pids) => { pids.forEach(p => aiMissed.add(p)); aiMessage = message }
  if (apiKey && aiContent) {
    const batches = []
    for (let i = 0; i < pidList.length; i += BATCH_SIZE) {
      batches.push(pidList.slice(i, i + BATCH_SIZE))
    }
    const total_batches = batches.length
    let done = 0
    const tasks = batches.map((batch, bi) => async () => {
      onProgress(`AI processing products ${bi * BATCH_SIZE + 1}–${Math.min((bi + 1) * BATCH_SIZE, pidList.length)} of ${pidList.length}... (batch ${bi + 1}/${total_batches})`)
      const result = await processProductsBatch(batch, apiKey, aiFailed, aiFields)
      Object.assign(aiCache, result)
      done += batch.length
    })
    await runConcurrent(tasks)
  } else {
    // No AI — local fix + basic fallback
    for (const p of pidList) aiCache[p.pid] = localContent(p)
  }
  // Products the AI missed (or answered with an empty field) get the same fallback.
  for (const p of pidList) {
    const c = aiCache[p.pid]
    if (!c || aiMissed.has(p.pid)) aiCache[p.pid] = localContent(p)
    else if (!c.name || !c.highlights || !c.description) {
      const local = localContent(p)
      aiCache[p.pid] = { name: c.name || local.name, highlights: c.highlights || local.highlights, description: c.description || local.description }
    }
  }

  // Apply word replacements to name, highlights, description — an unticked
  // highlights / description is the Basic file's text as it is.
  for (const p of pidList) {
    const c = aiCache[p.pid]
    aiCache[p.pid] = {
      name:        applyReplacements(c.name),
      highlights:  aiFields.highlights ? applyReplacements(c.highlights) : p.rawHighlights.trim(),
      description: aiFields.description ? applyReplacements(c.description) : p.rawDescription.trim(),
    }
  }

  // ── Step 4: Build output rows — separate valid vs invalid ──────────────────
  // Seller SKU must be unique: a repeated one is dropped (the first row kept).
  const seenSkus = new Set(), duplicateSkus = []
  const rowsToBuild = priceRows.filter(row => {
    const sku = String(row['SellerSKU'] || '').trim()
    if (!sku) return true
    if (seenSkus.has(sku)) {
      duplicateSkus.push({ sku, parent: String(row['Product ID'] || '').trim(), name: String(row['*Product Name(English)'] || '').trim() })
      return false
    }
    seenSkus.add(sku)
    return true
  })

  const items = []
  const invalidRows = []
  const total = rowsToBuild.length

  for (let i = 0; i < rowsToBuild.length; i++) {
    const row = rowsToBuild[i]
    if (i % 10 === 0) onProgress(`Building output row ${i + 1} of ${total}...`)

    const pid    = cell(row, 'Product ID')
    const cat    = cell(row, 'catId')
    const name   = cell(row, '*Product Name(English)')
    const sku    = cell(row, 'SellerSKU')
    const combo  = cell(row, 'Variations Combo')
    const status = cell(row, 'status')
    const price  = cell(row, '*Price', '**Price(MRP)', 'Price')

    const b = basicDict[pid] || {}
    const f = freightBySku[sku] || freightDict[pid] || {}
    const s = skuDict[sku] || {}

    const img1   = String(b['*Product Images1'] || '').trim()
    const skuImg = String(s['Images1'] || '').trim()

    // ── CartUp category: the mapping table only (a lookup — no AI) ────────────
    // No match: the row stays, Report says so and the Category Id is filled by hand.
    const isMystery = mystery_cats.includes(cat)
    let cartupId = '', cartupPath = '', tags = '', reportNote = ''
    if (!isMystery) {
      cartupId = daraz_to_cartup[cat] || ''
      if (cartupId) {
        cartupPath = cartup_map[cartupId]?.path || ''
        tags       = cartup_map[cartupId]?.tags || ''
        if (manual_cats.includes(cat)) reportNote = `Category mapped by hand (Daraz category ${cat})`
      } else {
        reportNote = `No CartUp category for Daraz category ${cat} — fill in the Category Id`
      }
    } else {
      reportNote = `Mystery/surprise box (Daraz category ${cat}) — no CartUp category; fill in the Category Id`
    }

    const applicable = cat_variant_map[cartupId] || []

    // ── Variant image logic ───────────────────────────────────────────────────
    // skuimg Images1 present → always use it
    // empty + no variant OR size-only → fall back to basic Image 1
    // empty + color variant (with or without size) → must come from skuimg or an
    // image key file; kept until the file is built, left out there if still empty
    const hasColorVariant = combo && applicable.includes('Color')
    const variantImage = skuImg || (hasColorVariant ? '' : img1)

    // ── Validity check ────────────────────────────────────────────────────────
    // Left out only for: no name, no price (MRP) — and no Product ID / Seller
    // SKU, without which a row can't be uploaded at all. No weight and (with an
    // image key file) no image key are decided when the file is built, as hand
    // edits can still fill them. Anything else stays, with a note in Report.
    const missing = []
    if (!pid)          missing.push('Product ID missing')
    if (!sku)          missing.push('Seller SKU missing')
    if (!name)         missing.push('Name missing')
    if (!price)        missing.push('Price (MRP) missing')

    if (missing.length > 0) {
      invalidRows.push({
        'Product ID':   pid,
        'SellerSKU':    sku,
        'Product Name': name,
        'catId':        cat,
        'Price':        price,
        'Image 1':      img1,
        'Variant Image':variantImage,
        'Quantity':     cell(row, '*Quantity'),
        'Status':       status,
        'Report':       missing.join(' | '),
      })
      continue
    }

    // ── Valid row — use AI cache ───────────────────────────────────────────────
    const brandFromFile = brandDict[pid]
    const brand = brandFromFile || 'No Brand'
    const ai    = aiCache[pid] || { name, highlights: '', description: '' }
    const fixedName   = ai.name
    const highlights  = ai.highlights
    const description = ai.description
    const warrantyPolicy  = String(b['Warranty Policy'] || '').trim()
    const warrantyTypeCol = b['*Warranty Type'] !== undefined ? '*Warranty Type' : 'Warranty Type'

    const images = Array.from({length: 8}, (_, idx) => {
      const k = idx === 0 ? '*Product Images1' : `Product Images${idx + 1}`
      return String(b[k] || '').trim()
    })

    // Raw values: dropdown and variant columns are matched in stage 2 and
    // filled in when the file is built (stage 3).
    const out = {
      '**Category Id':            cartupId,
      '**Name (English)':         fixedName,
      'Name (Bengali)':           fixedName,
      '**Product Image 1':        images[0], 'Product Image 2': images[1],
      'Product Image 3':          images[2], 'Product Image 4': images[3],
      'Product Image 5':          images[4], 'Product Image 6': images[5],
      'Product Image 7':          images[6], 'Product Image 8': images[7],
      'VideoUrl':                 '',
      '**Brand':                  brand,
      '**Unit':                   'pcs',
      'Tags':                     tags,
      'Clothing Materials':       '',
      'Shoe Material':            '',
      'Bag Material':             '',
      'Dial Materials':           '',
      'Strap Materials':          '',
      'Recommended Age':          '',
      'Watch Type':               '',
      'Main Materials':           '',
      'ISBN/ISSN':                isbnDict[pid] || '',
      'Highlights(English)':      highlights,
      'Highlights(Bengali)':      highlights,
      'Description (Bengali)':    description,
      'Description (English)':    description,
      "What's in the box":        `1* ${fixedName}`,
      'Warranty Policy(English)': warrantyPolicy,
      'Warranty Policy(Bangla)':  warrantyPolicy,
      'Warranty Type':            String(b[warrantyTypeCol] || '').trim(),
      'Warranty Period':          String(b['Warranty'] || '').trim(),
      '**Package Weight (kg)':    cell(f, '*Package Weight (kg)'),
      '**Package Length(cm)':     cell(f, '*Package Length (cm)'),
      '*Package Width (cm)':      cell(f, '*Package Width (cm)'),
      '*Package Height(cm)':      cell(f, '*Package Height (cm)'),
      'Clothing Size':            '',
      'Color':                    '',
      'Model':                    '',
      'Age Group':                '',
      'Size':                     '',
      'Shoe Size':                '',
      'Bedding Size':             '',
      '**Seller SKU':             sku,
      '**Parent Sku':             pid,
      '*Variant Image':           variantImage,
      '**Current Stock Qty':      cell(row, '*Quantity'),
      '**Price(MRP)':             price,
      'Special Price':            cell(row, 'SpecialPrice', 'Special Price'),
      'Special Price Start Date': cell(row, 'SpecialPrice Start', 'Special Price Start Date'),
      'Special Price End Date':   cell(row, 'SpecialPrice End', 'Special Price End Date'),
      'status':                   status,
      'Cartup Category Path':     cartupPath,
      'Variations Combo':         combo,
      'Report':                   reportNote,
    }

    const nameHow = !apiKey ? 'Name fixed (spelling rules)' : !aiName ? 'Name fixed (spelling rules — AI name check off)' : aiMissed.has(pid) ? 'Name fixed (spelling rules — AI unavailable)' : 'Name fixed by AI'
    items.push({ out, sku, parent: pid, name: fixedName, darazName: name, nameHow, combo, applicable, brandFromFile: !!brandFromFile,
      category: cartupPath, reportNote, image: variantImage, productImage: img1, images: images.filter(Boolean),
      darazCat: cat, pendingVariant: !variantImage })
  }

  matchItems(items, lists)
  return { items, invalidRows, duplicateSkus, skipped, total: allPriceRows.length, lists, template: !!lists, ai: apiKey ? { products: aiContent ? pidList.length : 0, missed: aiMissed.size, message: aiMessage, name: aiName, fields: aiFields } : null }
}

const groupBy = (arr, key) => {
  const m = new Map()
  for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return m
}
const NO_WARRANTY = /no warranty|^none$|^no$/i, REAL_WARRANTY = /seller|brand|manufacturer|agent|shop|official/i

// Warranty rules: "No Warranty" with a period → the period goes; Seller /
// Brand Warranty without a period → No Warranty. (A period that isn't on the
// list stays a value to review: pick one, keep it, or set No Warranty.)
function warrantyRules(it, lists) {
  const type = String(it.out['Warranty Type'] || '').trim(), period = String(it.out['Warranty Period'] || '').trim()
  const typeCell = it.cells.find(c => c.col === 'Warranty Type')
  const current = typeCell?.auto ?? type
  if (NO_WARRANTY.test(current) && period) {
    it.cells = it.cells.filter(c => c.col !== 'Warranty Period')
    it.fixed['Warranty Period'] = ''
    it.ruleChanges.push({ column: 'Warranty Period', from: period, to: '', change: 'Warranty rule: No Warranty — period removed' })
  } else if (REAL_WARRANTY.test(current) && !period) {
    const no = lists?.[headerKey('Warranty Type')]?.match('No Warranty')?.value || 'No Warranty'
    if (typeCell) { typeCell.auto = no; typeCell.how = 'rule'; typeCell.note = 'Warranty rule: no warranty period given' }
    else {
      it.fixed['Warranty Type'] = no
      it.ruleChanges.push({ column: 'Warranty Type', from: type, to: no, change: 'Warranty rule: no warranty period given → No Warranty' })
    }
  }
}

const FILL_DEFAULTS = { Color: 'Same as picture', Model: 'Same as picture', Size: 'One Size', 'Clothing Size': 'One Size', 'Shoe Size': 'One Size', 'Bedding Size': 'One Size' }

// Stage 2 — every dropdown value against the template's lists (or none, when
// no template is given). Repeatable: a newer template only re-runs this.
export function matchItems(items, lists) {
  for (const group of groupBy(items, it => it.parent).values()) {
    // Variations Combo → variant columns, guided by the pattern of the product's other SKUs.
    const plan = planParent(group.map(it => it.combo), group[0].applicable, lists)
    for (const it of group) {
      const parts = splitCombo(it.combo)
      const placed = placeParts(parts, plan, it.applicable, lists)
      it.cells = []; it.unused = []; it.fixed = {}; it.ruleChanges = []
      parts.forEach((part, p) => placed[p] ? it.cells.push(makeCell(placed[p], part, lists)) : it.unused.push(part))
      // A variant column the category needs but the seller didn't fill (no
      // variant, or a variant of another kind): Color / Model → "Same as
      // picture", a size → "One Size" — in the list's own spelling.
      for (const [col, value] of Object.entries(FILL_DEFAULTS)) {
        if (it.applicable.includes(col) && !it.cells.some(c => c.col === col)) it.cells.push(makeCell(col, value, lists, 'fill'))
      }
      // Every other dropdown column (Brand, Unit, Warranty…).
      if (lists) {
        for (const col of OUTPUT_COLS) {
          const v = String(it.out[col] ?? '').trim()
          if (COMBO_TARGETS.includes(col) || !v || !lists[headerKey(col)]) continue
          const ours = col === '**Unit' || (col === '**Brand' && !it.brandFromFile)   // filled in by us, not the seller
          it.cells.push(makeCell(col, v, lists, ours ? 'default' : 'daraz'))
        }
      }
      warrantyRules(it, lists)
    }
    // One size format per product; variants that would end up identical numbered apart (Multicolor-1, -2…).
    harmonizeSizes(group, lists)
    separateCollisions(group, lists)
  }
  return items
}

// Same run, checked against a newer template (e.g. after values were added to
// CartUp's lists) — no files read, no AI.
export function rematch(result, lists) {
  const items = result.items.map(it => ({ ...it }))
  matchItems(items, lists)
  return { ...result, items, lists, template: !!lists }
}

// Key of a row for hand edits (Seller SKUs are unique after stage 1).
export const rowKey = (item, i) => item.sku || `row ${i + 1}`

// Stage 3 — the final rows: review decisions, then the house rules, then hand
// edits from the sheet view (the last word). Every change goes to the log.
// options: { specialPrice: { include, start, end }, stock: { set: number | null }, imageKeys (makeImageKeyMap), edits: { [rowKey]: { [col]: value } },
//            deleted: Set of row keys deleted in the sheet view (left out, listed in "invalid") }
export function buildOutput(result, decisions = {}, memory = {}, options = {}) {
  const applied = applyDecisions(result, decisions, memory)
  const { specialPrice = { include: true, start: todayISO(), end: '' }, stock = { set: null }, imageKeys = null, edits = {}, deleted = null } = options
  const problems = [], excluded = new Set(), leftOut = [], deletedRows = new Set()
  const rules = { discountRemoved: 0, spNotBelow: 0, stockCapped: 0, stockSet: 0, stockZero: 0, namesHash: 0, imageKeyed: 0, imageMissing: 0,
    keyRows: 0, keyRowsMissing: 0, leftNoImage: 0, leftNoVariant: 0, leftNoWeight: 0, deleted: 0, numbered: 0, imagesMoved: 0, edited: 0, specialPrices: 0 }
  const numberedBy = new Map()
  for (const nb of applied.numbered || []) { if (!numberedBy.has(nb.row)) numberedBy.set(nb.row, []); numberedBy.get(nb.row).push(nb) }
  const stockSet = stock?.set == null || stock.set === '' ? null : Math.min(99999, Math.max(0, Math.round(Number(stock.set) || 0)))
  applied.rows.forEach((out, i) => {
    const item = result.items[i]
    const log = (column, from, to, change) => applied.changes.push({ sku: item.sku, parent: item.parent, name: item.name, column, from: String(from ?? ''), to: String(to ?? ''), change, detail: '' })
    // A row deleted in the sheet view is left out and not flagged.
    const isDeleted = !!deleted?.has(rowKey(item, i))
    // type (optional): the sheet's problem type for this flag (see checks.js ISSUE_TYPES)
    const flag = (column, problem, type) => { if (isDeleted) return; problems.push({ sku: item.sku, parent: item.parent, row: i, column, value: String(out[column] ?? ''), problem, type }); applied.attention.add(i) }
    const notes = []

    for (const [c, v] of Object.entries(item.fixed || {})) out[c] = v
    for (const rc of item.ruleChanges || []) log(rc.column, rc.from, rc.to, rc.change)

    // Name: "#" becomes "-".
    const hash = /#/.test(item.name)
    for (const c of ['**Name (English)', 'Name (Bengali)', "What's in the box"]) out[c] = String(out[c] ?? '').replace(/#/g, '-')
    if (hash) rules.namesHash++
    if (item.darazName && out['**Name (English)'] !== item.darazName) {
      log('Name (English)', item.darazName, out['**Name (English)'], [item.name !== item.darazName ? item.nameHow : '', hash ? '"#" replaced with "-"' : ''].filter(Boolean).join(' · '))
    }

    // Stock: one number for every row when chosen (a seller who wants to upload with 0 stock).
    if (stockSet !== null && String(out['**Current Stock Qty'] ?? '') !== String(stockSet)) {
      log('Current Stock Qty', out['**Current Stock Qty'], stockSet, `Stock set to ${stockSet} for every row (upload option)`)
      out['**Current Stock Qty'] = String(stockSet)
      rules.stockSet++
    }
    // Stock never above 99,999.
    if (Number(out['**Current Stock Qty']) > 99999) {
      log('Current Stock Qty', out['**Current Stock Qty'], 99999, 'Stock capped at 99,999')
      out['**Current Stock Qty'] = '99999'
      rules.stockCapped++
    }

    // Special price: only when wanted; a discount of 75% or more (up to 100% —
    // a special price of 0) removes the special price, never the SKU; dates =
    // today → the chosen end.
    const spText = String(out['Special Price'] ?? '').trim()
    const sp = Number(spText), mrp = Number(out['**Price(MRP)'])
    const clearSpecial = () => { out['Special Price'] = ''; out['Special Price Start Date'] = ''; out['Special Price End Date'] = '' }
    if (!specialPrice.include || spText === '' || Number.isNaN(sp)) clearSpecial()
    else if (mrp > 0 && 1 - sp / mrp >= 0.75) {
      const pct = Math.min(100, Math.round((1 - sp / mrp) * 100))
      const why = `Special price ${spText} removed — ${pct}% discount (75% or more); the SKU stays`
      log('Special Price', spText, '', why)
      notes.push(`Special price removed: ${pct}% discount`)
      clearSpecial()
      flag('Special Price', why, 'spremoved')
      rules.discountRemoved++
    } else {
      out['Special Price Start Date'] = specialPrice.start
      out['Special Price End Date'] = specialPrice.end || ''
      rules.specialPrices++
    }

    // Image links → CartUp image keys, when a key file is loaded: per Seller SKU
    // (a column for each image), or link by link.
    const keyRow = imageKeys?.forItem ? imageKeys.forItem(item) : null
    if (imageKeys?.forItem) {
      if (keyRow) {
        rules.keyRows++
        for (const [c, key] of Object.entries(keyRow)) if (out[c] !== key) { out[c] = key; rules.imageKeyed++ }
      } else rules.keyRowsMissing++
    } else if (imageKeys) {
      for (const c of IMAGE_COLS) {
        const key = String(out[c] ?? '').trim() && imageKeys.lookup(out[c])
        if (key) { out[c] = key; rules.imageKeyed++ }
      }
    }

    // Hand edits from the sheet view — the last word on any value.
    for (const [c, v] of Object.entries(edits[rowKey(item, i)] || {})) {
      if (String(out[c] ?? '') === v) continue
      log(colLabel(c), out[c], v, 'Edited by hand (sheet view)')
      out[c] = v
      rules.edited++
    }

    // With a key file the images are the file's: a Daraz link still without a
    // key (after edits, so a pasted key counts) is not uploaded — logged in
    // changes, not flagged. The product images left move up to fill the gaps
    // (Image 1 is the first one with a key).
    if (imageKeys) {
      const why = imageKeys.forItem && !keyRow ? 'Seller SKU not in the image key file' : 'No CartUp image key for this link'
      for (const c of IMAGE_COLS) {
        const link = String(out[c] ?? '').trim()
        if (!/^https?:\/\//i.test(link)) continue
        log(colLabel(c), link, '', `${why} — image not uploaded`)
        out[c] = ''
        rules.imageMissing++
      }
      const productCols = IMAGE_COLS.slice(0, 8)
      const kept = productCols.map(c => String(out[c] ?? '').trim()).filter(Boolean)
      if (kept.length && kept.some((v, k) => v !== String(out[productCols[k]] ?? '').trim())) {
        productCols.forEach((c, k) => { out[c] = kept[k] ?? '' })
        rules.imagesMoved++
      }
      // Not a colour variant: the variant image may be Image 1, as in stage 1.
      const colour = item.combo && item.applicable?.includes('Color')
      if (!String(out['*Variant Image']).trim() && out['**Product Image 1'] && !colour) out['*Variant Image'] = out['**Product Image 1']
    }
    // Left out of the upload only for: no package weight, or (with an image
    // key file) no CartUp key for Image 1 / the Variant Image. Without a key
    // file a missing image is flagged and the row stays. Decided after the
    // hand edits, so a weight or key typed in the sheet keeps the row.
    const reasons = []
    const noImg1 = !String(out['**Product Image 1'] ?? '').trim(), noVariant = !String(out['*Variant Image'] ?? '').trim()
    if (imageKeys) {
      if (noImg1) { flag('**Product Image 1', 'No CartUp image key for any product image — row left out ("invalid")', 'leftout'); reasons.push('Images: no CartUp image key'); rules.leftNoImage++ }
      if (noVariant) { flag('*Variant Image', 'No CartUp image key for the Variant Image — row left out ("invalid")', 'leftout'); reasons.push('Variant Image: no CartUp image key'); rules.leftNoVariant++ }
    } else {
      if (noImg1) { flag('**Product Image 1', 'Image 1 missing (product not in the Basic file) — add it', 'noimage'); notes.push('Image 1 missing — add it') }
      if (noVariant) { flag('*Variant Image', 'Variant Image missing (colour variant not in the SKU Image file) — add it', 'noimage'); notes.push('Variant Image missing — add it') }
    }
    if (!String(out['**Package Weight (kg)'] ?? '').trim()) {
      flag('**Package Weight (kg)', 'No package weight — row left out ("invalid"); type the weight to keep it', 'leftout')
      reasons.push('Package weight empty')
      rules.leftNoWeight++
    }
    if (isDeleted) { reasons.splice(0, reasons.length, 'Deleted by hand (sheet view)'); rules.deleted++; deletedRows.add(i) }
    if (reasons.length) {
      excluded.add(i)
      notes.push(`Left out: ${reasons.join(', ')}`)
      leftOut.push({ 'Product ID': out['**Parent Sku'], 'SellerSKU': out['**Seller SKU'], 'Product Name': out['**Name (English)'], 'catId': item.darazCat ?? '',
        'Price': out['**Price(MRP)'], 'Image 1': out['**Product Image 1'], 'Variant Image': out['*Variant Image'], 'Quantity': out['**Current Stock Qty'], 'Status': out['status'],
        'Report': reasons.join(' | ') })
    }
    // A special price must be below the price (checked after edits, so a fixed one isn't flagged).
    const spNow = Number(out['Special Price']), mrpNow = Number(out['**Price(MRP)'])
    if (spNow > 0 && mrpNow > 0 && spNow >= mrpNow) {
      flag('Special Price', `Not below the price (${out['**Price(MRP)']}) — CartUp may reject it`, 'price')
      rules.spNotBelow++
    }
    const stockText = String(out['**Current Stock Qty'] ?? '').trim()
    if (stockText !== '' && Number(stockText) === 0) rules.stockZero++
    // Variants told apart only by a number (Multicolor-1, -2…): the seller's
    // variants differ by something CartUp has no column for — flagged to check.
    for (const nb of numberedBy.get(i) || []) {
      if (isDeleted || out[nb.col] !== nb.value) continue
      const lost = item.unused?.length ? `they differ by "${item.unused.join(', ')}", which has no CartUp column` : `"${item.combo}"`
      flag(nb.col, `${colLabel(nb.col)} numbered to keep the variants apart: ${nb.value} (Daraz: ${nb.raw}; ${lost}) — check it, or pick a real value`, 'numbered')
      notes.push(`Check: ${colLabel(nb.col)} = ${nb.value} only to keep variants apart (${lost})`)
      rules.numbered++
    }
    if (notes.length) out['Report'] = [out['Report'], ...notes].filter(Boolean).join(' | ')
    // Check = YES: the row needs a person's look (a flag, a value set by rule,
    // no category, left out) — the reason is in Report.
    if (isDeleted) applied.attention.delete(i)
    out['Check'] = isDeleted ? '' : applied.attention.has(i) || applied.filledRows?.has(i) || !String(out['**Category Id'] ?? '').trim() || excluded.has(i) ? 'YES' : ''
  })
  // excluded: row indexes left out of the upload (leftOut: their "invalid" rows)
  return { ...applied, problems, rules, excluded, leftOut, deletedRows }
}

// The output for a processed run: decisions, rules and edits applied. With the
// CartUp template (options.template, a File) the template itself is filled —
// its columns and formulas kept; more rows than it holds → a .zip of parts.
// → { bytes, name, output, parts, hiddenErrors }
export async function buildDarazWorkbook(result, decisions = {}, memory = {}, options = {}) {
  const output = buildOutput(result, decisions, memory, options)
  const invalid = [...result.invalidRows, ...output.leftOut]
  const summary = darazSummary(result, output, options)
  if (options.template) {
    const { files } = await buildTemplateFiles(options.template, output, invalid, result.lists, summary)
    const hiddenErrors = files.reduce((n, f) => n + f.errors, 0)
    if (files.length === 1) return { bytes: files[0].bytes, name: 'cartup_daraz_output.xlsx', output, parts: 1, hiddenErrors }
    return { bytes: await zipFiles(files, 'cartup_daraz_output'), name: 'cartup_daraz_output.zip', output, parts: files.length, hiddenErrors }
  }
  const bytes = buildExcel(output, invalid, result.lists, summary)
  return { bytes: await wrapCell(bytes, 'summary', 'A1'), name: 'cartup_daraz_output.xlsx', output, parts: 1, hiddenErrors: 0 }
}

// SheetJS (community) writes no cell styles: "wrap text" is added in the XML
// so the summary cell shows its lines as lines.
async function wrapCell(bytes, sheetName, ref) {
  const zip = await JSZip.loadAsync(bytes)
  const book = await zip.file('xl/workbook.xml').async('string')
  const names = [...book.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(m => m[1])
  const sheetFile = zip.file(`xl/worksheets/sheet${names.indexOf(sheetName) + 1}.xml`)
  if (!names.includes(sheetName) || !sheetFile) return bytes
  let styles = await zip.file('xl/styles.xml').async('string')
  const count = Number(styles.match(/<cellXfs count="(\d+)"/)?.[1])
  if (!count) return bytes
  styles = styles.replace(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/, (_, xfs) =>
    `<cellXfs count="${count + 1}">${xfs}<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>`)
  const sheet = (await sheetFile.async('string')).replace(new RegExp(`<c r="${ref}"( s="\\d+")?`), `<c r="${ref}" s="${count}"`)
  zip.file('xl/styles.xml', styles)
  zip.file(sheetFile.name, sheet)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// Which content the AI cleaned, for the summary and the page.
export function aiSummary(ai) {
  if (!ai) return 'AI: off (spelling fix only)'
  const f = ai.fields || { name: ai.name !== false, highlights: true, description: true }
  const on = ['name', 'highlights', 'description'].filter(k => f[k]), off = ['name', 'highlights', 'description'].filter(k => !f[k])
  const offText = off.map(k => k === 'name' ? 'name: spelling rules only' : `${k}: as in the Basic file`).join(' · ')
  if (!on.length) return `AI: off for name, highlights and description — ${offText}`
  return `AI (${on.join(', ')}): ${(ai.products - ai.missed).toLocaleString()} of ${ai.products.toLocaleString()} products cleaned`
    + (ai.missed ? ` (${ai.missed.toLocaleString()} local clean-up only)` : '') + (off.length ? ` · AI check off — ${offText}` : '')
}

// The run in a few lines (one cell of the "summary" sheet, or copied from the
// page): how many rows went in, and how many were left out or changed for
// inactive, price, image, weight, stock… A row left out for two reasons
// counts under both.
export function darazSummary(result, output, options = {}) {
  const n = v => Number(v || 0).toLocaleString()
  const s = (v, one, many = one + 's') => `${n(v)} ${v === 1 ? one : many}`
  const r = output.rules
  const out = [...result.invalidRows, ...output.leftOut]
  const leftFor = re => out.filter(row => String(row.Report).split(' | ').some(x => re.test(x))).length
  const uploaded = output.rows.filter((_, i) => !output.excluded.has(i))
  const products = new Set(uploaded.map(row => row['**Parent Sku'])).size
  const total = result.total ?? output.rows.length + result.invalidRows.length + result.duplicateSkus.length + (result.skipped || 0)
  const left = total - uploaded.length
  const join = parts => parts.filter(Boolean).join(' · ')
  const lines = [
    `CartUp upload summary — ${todayISO()}`,
    `Rows: ${n(total)} in the Price file → ${s(uploaded.length, 'row')} uploaded (${s(products, 'product')}) · ${n(left)} left out`,
    `Inactive: ${options.activeOnly || result.skipped ? `${n(result.skipped)} left out (Active only)` : '0 left out (all rows taken)'}`,
    `Price: ${join([`${n(leftFor(/^Price/))} left out (no price / MRP)`, `${s(r.discountRemoved, 'special price')} removed (75–100% discount — SKU kept)`,
      r.spNotBelow && `${s(r.spNotBelow, 'special price')} not below the price (flagged)`])}`,
    `Image: ${join([options.imageKeys ? `${n(leftFor(/^(Images|Variant Image):/))} left out — no CartUp image key (${n(leftFor(/^Images:/))} for any product image, ${n(leftFor(/^Variant Image:/))} for the variant image)` : '0 left out',
      options.imageKeys && `${s(r.imageKeyed, 'image')} → CartUp keys`, options.imageKeys && r.imageMissing && `${s(r.imageMissing, 'image')} without a key not uploaded`, options.imageKeys && r.imagesMoved && `${s(r.imagesMoved, 'row')} with images moved up to fill gaps`,
      options.imageKeys?.forItem && r.keyRowsMissing && `${s(r.keyRowsMissing, 'Seller SKU')} not in the key file`,
      !options.imageKeys && 'no image key file (Daraz links)',
      !options.imageKeys && output.problems.filter(p => p.type === 'noimage').length && `${n(output.problems.filter(p => p.type === 'noimage').length)} images missing (rows kept — flagged)`])}`,
    `Weight: ${n(leftFor(/weight/i))} left out (no package weight)`,
    `Stock: ${join([r.stockSet && `${n(r.stockSet)} set to one number`, `${n(r.stockCapped)} capped at 99,999`, `${n(r.stockZero)} with 0 stock`])}`,
    `Other left out: ${join([`${n(leftFor(/^Product ID/))} no Product ID`, `${n(leftFor(/^Seller SKU/))} no Seller SKU`, `${n(leftFor(/^Name/))} no name`,
      `${n(result.duplicateSkus.length)} repeated Seller SKU`, r.deleted && `${n(r.deleted)} deleted by hand`])}`,
    `Category: ${n(uploaded.filter(row => !String(row['**Category Id'] ?? '').trim()).length)} uploaded rows without a CartUp category (no AI — fill in the Category Id)`,
    `Variants: ${n(output.filledRows?.size || 0)} rows got a value set by rule (Color / Model = Same as picture, size = One Size)${r.numbered ? ` · ${n(r.numbered)} told apart only by a number (Multicolor-1…) — check` : ''}`,
    `Check = YES: ${n(uploaded.filter(row => row.Check === 'YES').length)} uploaded rows to look at (reason in Report)`,
    aiSummary(result.ai),
    r.edited ? `Edited by hand: ${s(r.edited, 'cell')}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

// ── Image keys ────────────────────────────────────────────────────────────────
// A sheet that pairs Daraz image links with CartUp image keys (the keys can
// arrive before or after the products are processed). Links match even when
// Daraz adds a size suffix or query (…abc.jpg_720x720q80.jpg_.webp, ?v=2).
const imageId = u => String(u).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[?#].*$/, '')
  .replace(/(\.(jpe?g|png|webp|gif))(_\d+x\d+(q\d+)?\.(jpe?g|png|webp))?(_\.webp)?$/, '$1')
const imageFile = u => imageId(u).split('/').pop()

export function readTableFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        resolve(wb.SheetNames.map(name => {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
          return { name, rows, columns: rows.length ? Object.keys(rows[0]) : [] }
        }).filter(s => s.rows.length))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}
// Best guess of the link and key columns: the one most full of web links, and
// the other with the most values (preferring a header that says "key").
export function guessImageColumns(sheet) {
  const share = (c, test) => sheet.rows.filter(r => test(String(r[c] ?? '').trim())).length / sheet.rows.length
  const link = [...sheet.columns].sort((a, b) => share(b, v => /^https?:\/\//i.test(v)) - share(a, v => /^https?:\/\//i.test(v)))[0] || ''
  const key = sheet.columns.filter(c => c !== link)
    .sort((a, b) => (/key/i.test(b) - /key/i.test(a)) || share(b, v => v && !/^https?:\/\//i.test(v)) - share(a, v => v && !/^https?:\/\//i.test(v)))[0] || ''
  return { link, key }
}
export function makeImageKeyMap(rows, linkCol, keyCol) {
  const byId = new Map(), byFile = new Map()
  for (const r of rows) {
    const link = String(r[linkCol] ?? '').trim(), key = String(r[keyCol] ?? '').trim()
    if (!link || !key) continue
    if (!byId.has(imageId(link))) byId.set(imageId(link), key)
    if (!byFile.has(imageFile(link))) byFile.set(imageFile(link), key)
  }
  return { size: byId.size, lookup: v => byId.get(imageId(v)) ?? byFile.get(imageFile(v)) ?? null }
}

// Or the keys already per SKU: one row per Seller SKU with a column for each
// image (Images 1…, Variant 1). slots: { output image column: key file column }.
// Rows are found by Seller SKU, or by Product ID when that is the match column.
export function makeImageKeyColumns(rows, matchCol, slots) {
  const byValue = new Map()
  const used = Object.entries(slots).filter(([, col]) => col)
  for (const r of rows) {
    const v = String(r[matchCol] ?? '').trim()
    if (!v || byValue.has(v)) continue
    const keys = {}
    for (const [out, col] of used) { const k = String(r[col] ?? '').trim(); if (k) keys[out] = k }
    byValue.set(v, keys)
  }
  return { size: used.length ? byValue.size : 0, slots: used.length,
    forItem: it => used.length ? byValue.get(String(it.sku ?? '').trim()) ?? byValue.get(String(it.parent ?? '').trim()) ?? null : null }
}

// Which layout the key file has, and its columns. Keys per SKU when it has a
// Seller SKU (or Product ID) column and image-named columns without web links.
export function guessImageKeys(sheet) {
  const { link, key } = guessImageColumns(sheet)
  const cols = sheet.columns
  const find = test => cols.find(c => test(String(c).trim()))
  const match = find(c => /^\**\s*seller\s*_?sku$/i.test(c)) || find(c => /seller\s*_?sku/i.test(c)) || find(c => /shop\s*sku/i.test(c)) || find(c => /product\s*id/i.test(c)) || ''
  const slots = Object.fromEntries(IMAGE_COLS.map((oc, n) => [oc, n === 8
    ? find(c => /variant/i.test(c) && !/combo|name|sku/i.test(c)) || ''
    : find(c => new RegExp(`^\\**\\s*(product\\s*)?images?\\s*${n + 1}$`, 'i').test(c)) || '']))
  const urls = c => sheet.rows.filter(r => /^https?:\/\//i.test(String(r[c] ?? '').trim())).length > sheet.rows.length / 2
  const mode = match && Object.values(slots).some(c => c && !urls(c)) && !urls(link) ? 'columns' : 'link'
  return { mode, link, key, match, slots }
}

// The tabs after the product sheet, as rows — the same in either kind of file.
// applied: buildOutput(...) — change log, flagged values, values not on the lists.
// errors: hidden-sheet errors (#N/A…) found while filling the template.
// → [{ name, rows, widths, head (first row is a header), wrap (one wrapped cell) }]
function reportTabs(applied, invalidRows, lists, summary, errors = []) {
  const tabs = []
  if (invalidRows.length) {
    const invCols = ['Product ID', 'SellerSKU', 'Product Name', 'catId', 'Price', 'Image 1', 'Variant Image', 'Quantity', 'Status', 'Report']
    tabs.push({ name: 'invalid', head: true, widths: invCols.map(c => c === 'Report' ? 55 : 22), rows: [invCols, ...invalidRows.map(r => invCols.map(c => r[c] ?? ''))] })
  }
  // Every change, one row per Seller SKU and column.
  tabs.push({ name: 'changes', head: true, widths: [24, 16, 36, 16, 30, 30, 40, 34], rows: [
    ['Seller SKU', 'Parent SKU', 'Product', 'Column', 'Daraz value', 'Output value', 'Change', 'Detail'],
    ...(applied.changes.length ? applied.changes.map(c => [c.sku, c.parent, c.name, c.column, c.from, c.to, c.change, c.detail]) : [['', '', '', '', '', '', 'No changes']]),
  ] })
  // Flagged cells, and cells of the hidden sheet that came out as an error.
  const checks = [
    ...applied.problems.map(p => [p.sku, p.parent, p.column.replace(/^\*+/, ''), p.value, p.problem]),
    ...errors.map(e => [e.sku, '', e.column, e.value, e.error === '#N/A'
      ? `#N/A in the hidden sheet — "${e.value}" is not on the template's ${e.column} list (file row ${e.fileRow}); pick a list value or the upload rejects the row`
      : `${e.error} in the hidden sheet's ${e.column} formula (file row ${e.fileRow})`]),
  ]
  tabs.push({ name: 'to check', head: true, widths: [24, 16, 22, 40, 70], rows: [['Seller SKU', 'Parent SKU', 'Column', 'Value', 'Problem'], ...(checks.length ? checks : [['', '', '', '', 'Nothing to check']])] })
  // Values not on CartUp's lists (to match, or to add to the list).
  if (lists) {
    const sorted = [...applied.newValues].sort((a, b) => a.decided - b.decided || b.skus.length - a.skus.length)
    tabs.push({ name: 'new values', head: true, widths: [16, 30, 44, 7, 11, 40, 50], rows: [
      ['Column', 'Value', 'Status', 'SKUs', 'Parent SKUs', 'Seller SKUs', 'Closest CartUp values'],
      ...sorted.map((nv, k) => [
        nv.column, nv.value,
        nv.decided ? 'Add to the CartUp list (decided)' : 'Not reviewed — shows #N/A until matched or added',
        nv.skus.length, nv.parents.length,
        nv.skus.slice(0, 10).join(', ') + (nv.skus.length > 10 ? ` … +${nv.skus.length - 10}` : ''),
        k < 300 ? (lists[nv.listKey]?.suggest(nv.value, 3) || []).join(' · ') : '',
      ]),
      ...(sorted.length ? [] : [['', '', 'Every value is on the CartUp lists']]),
    ] })
  }
  // The whole report in cell A1 (copy one cell).
  if (summary) tabs.push({ name: 'summary', wrap: true, widths: [120], rows: [[summary]] })
  return tabs
}

// A file without the CartUp template: its columns in its order (none left
// out), then Report, Check and our extra columns; the tabs after it.
function buildExcel(applied, invalidRows = [], lists = null, summary = '') {
  const wb = XLSX.utils.book_new()
  const validRows = applied.rows.filter((_, i) => !applied.excluded?.has(i))
  const sections = TEMPLATE_LAYOUT.flatMap(([name, cols]) => cols.map((_, k) => k ? '' : name))
  const headers = TEMPLATE_LAYOUT.flatMap(([, cols]) => cols)
  const ours = headers.map(h => OUR_COL[headerKey(h)])
  const ws = XLSX.utils.aoa_to_sheet([sections, headers, ...validRows.map(r => ours.map(c => c ? r[c] ?? '' : ''))])
  ws['!cols'] = headers.map((h, i) => ({ wch: i === 1 ? 50 : h === 'Report' || h === 'Cartup Category Path' ? 45 : 20 }))
  ws['!freeze'] = { xSplit: 0, ySplit: 2 }
  XLSX.utils.book_append_sheet(wb, ws, 'product')
  for (const t of reportTabs(applied, invalidRows, lists, summary)) {
    const wst = XLSX.utils.aoa_to_sheet(t.rows)
    wst['!cols'] = t.widths.map(wch => ({ wch }))
    if (t.head) wst['!freeze'] = { xSplit: 0, ySplit: 1 }
    if (t.wrap) wst['!rows'] = [{ hpt: 15 * String(t.rows[0][0]).split('\n').length + 6 }]
    XLSX.utils.book_append_sheet(wb, wst, t.name)
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}

// Numbers in the template's number columns are written as numbers.
const NUMBER_COLS = new Set(['**Category Id', '**Package Weight (kg)', '**Package Length(cm)', '*Package Width (cm)', '*Package Height(cm)',
  '**Current Stock Qty', '**Price(MRP)', 'Special Price'])
const typed = (c, v) => NUMBER_COLS.has(c) && /^-?\d+(\.\d+)?$/.test(String(v ?? '').trim()) ? Number(v) : v ?? ''

// The CartUp upload template itself, filled: every sheet, column, dropdown and
// hidden formula of the template stays (its payload_hidden formulas are
// computed for the new rows); Report and Check go in the first free columns
// after the template's, and the report tabs after its sheets. More rows than
// one template holds → several files (variants of a product kept together).
// → { bytes, parts, notes }
async function buildTemplateFiles(templateFile, applied, invalidRows, lists, summary) {
  const tpl = await loadTemplate(await templateFile.arrayBuffer())
  const colOf = new Map()
  for (const c of tpl.columns) if (c.key && OUR_COL[c.key] && !colOf.has(OUR_COL[c.key])) colOf.set(OUR_COL[c.key], c.col)
  const last = Math.max(...tpl.columns.map(c => colToNum(c.col)))
  const reportCol = numToCol(last + 1), checkCol = numToCol(last + 2)
  const rows = []
  applied.rows.forEach((r, i) => {
    if (applied.excluded?.has(i)) return
    const values = {}
    for (const [c, col] of colOf) if (c !== 'Report' && c !== 'Check') values[col] = typed(c, r[c])
    values[reportCol] = r.Report ?? ''
    values[checkCol] = r.Check ?? ''
    rows.push({ values, parent: String(r['**Parent Sku'] ?? ''), source: { __row: i + 3 } })
  })
  if (!rows.length) throw new Error('No rows to upload — every row was left out')
  const chunks = chunkRows(rows, tpl.capacity)
  const files = []
  for (let k = 0; k < chunks.length; k++) {
    const errors = []
    let tabs = null
    const part = chunks.length > 1 ? `\nThis file: part ${k + 1} of ${chunks.length} — ${chunks[k].length.toLocaleString()} rows` : ''
    const tab = name => () => {
      tabs ||= reportTabs(applied, invalidRows, lists, summary + part + tpl.notes.map(n => `\nTemplate: ${n}`).join(''), errors)
      const t = tabs.find(x => x.name === name)
      return t.wrap ? [[{ v: t.rows[0][0], s: 'wrap' }]] : t.rows.map((cells, n) => n === 0 && t.head ? cells.map(v => ({ v, s: 'head' })) : cells)
    }
    const names = reportTabs(applied, invalidRows, lists, summary).map(t => ({ name: t.name, widths: t.widths, wrap: t.wrap }))
    const bytes = await writeTemplate(tpl, chunks[k], {
      errors,
      headers: { [reportCol]: 'Report', [checkCol]: 'Check' },
      sheets: names.map(t => ({ name: t.name, rows: tab(t.name), widths: t.widths, heights: t.wrap ? { 0: 15 * (summary.split('\n').length + 3) + 6 } : {} })),
    })
    files.push({ rows: chunks[k].length, bytes, errors: errors.length })
  }
  return { files, notes: tpl.notes, capacity: tpl.capacity }
}
