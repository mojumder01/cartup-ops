import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'
import { processProductsBatch, matchCategoriesBatch, localFixName, runConcurrent } from './gemini'

const { cartup_map } = MAPPINGS

const SECTIONS = [
  { name: 'Basic Information',   color: 'FFD9E1F2', cols: 15 },
  { name: 'Product Attribute',   color: 'FFE2EFDA', cols: 8  },
  { name: 'Product Description', color: 'FFFCE4D6', cols: 5  },
  { name: 'Service',             color: 'FFFFF2CC', cols: 4  },
  { name: 'Delivery',            color: 'FFDDEBF7', cols: 4  },
  { name: 'Variant Attribute',   color: 'FFF2F2F2', cols: 11 },
  { name: 'Extra',               color: 'FFEDEDED', cols: 8  },
]

const OUTPUT_COLS = [
  '**Category Id','**Name (English)','Name (Bengali)',
  '**Product Image 1','Product Image 2','Product Image 3','Product Image 4',
  'Product Image 5','Product Image 6','Product Image 7','Product Image 8',
  'VideoUrl','**Brand','**Unit','Tags',
  'Clothing Materials','Shoe Material','Bag Material','Dial Materials',
  'Strap Materials','Recommended Age','Watch Type','Main Materials',
  'Highlights(English)','Highlights(Bengali)','Description (Bengali)','Description (English)',
  "What's in the box",
  'Warranty Policy(English)','Warranty Policy(Bangla)','Warranty Type','Warranty Period',
  '**Package Weight (kg)','**Package Length(cm)','*Package Width (cm)','*Package Height(cm)',
  'Clothing Size','Color','Model','Age Group','Size','Shoe Size','Bedding Size',
  '**Seller SKU','**Parent Sku','*Variant Image','**Current Stock Qty',
  '**Price(MRP)','Special Price','Special Price Start Date','Special Price End Date',
  'status','Cartup Category Path','Report'
]

// Template column headers for download
const TEMPLATE_COLS = [
  'Name*','Description','Highlights',
  'Image 1','Image 2','Image 3','Image 4','Image 5','Image 6','Image 7','Image 8',
  'Brand','Parent SKU','Color','Size',
  'Price','Special Price','Special Start Date','Special End Date',
  'Stock','Status',
  'Weight(kg)','Length(cm)','Width(cm)','Height(cm)',
  'Warranty',
]

function ensureHtmlHighlights(text, name) {
  if (!text) return `<ul><li>${name}</li></ul>`
  if (text.startsWith('<ul>') || text.startsWith('<ol>')) return text
  const lines = text.split(/[\n\r]+/).map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
  if (!lines.length) return `<ul><li>${name}</li></ul>`
  return `<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`
}

function ensureHtmlDescription(text, name) {
  if (!text) return `<p>${name}</p>`
  if (text.startsWith('<p>') || text.startsWith('<div>')) return text
  return `<p>${text.trim()}</p>`
}

// Flexible column finder
function col(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(h => h.toLowerCase().trim() === k.toLowerCase())
    if (found && row[found] !== undefined && row[found] !== '') return String(row[found]).trim()
  }
  return ''
}

function splitVariants(str) {
  if (!str) return []
  return str.split(',').map(v => v.trim()).filter(Boolean)
}

function buildSellerSku(parentSku, colorVal, sizeVal) {
  const parts = [parentSku, colorVal, sizeVal].filter(Boolean)
  return parts.join('_')
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        resolve(rows)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function getCartupCategories() {
  return Object.entries(cartup_map).map(([id, v]) => ({ id, path: v.path }))
}

export function generateTemplate() {
  const wb = XLSX.utils.book_new()

  // ── Sheet 1: template ───────────────────────────────────────────────────────
  const requiredCols = new Set(['Name*', 'Parent SKU'])
  const exampleRow = [
    'Pet Shampoo for Dogs','Gentle daily-use shampoo for dogs and cats.','• Kills fleas & ticks\n• Moisturizes coat\n• Safe for pets',
    'https://image1.jpg','https://image2.jpg','','','','','','',
    'Bengal','SWE77556','Black,Blue,Red','S,M,L',
    '999','799','01/01/2025','31/12/2025',
    '10','active',
    '0.5','20','15','5',
    '6 Months',
  ]
  const wsData = [TEMPLATE_COLS, exampleRow]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Column widths
  ws['!cols'] = TEMPLATE_COLS.map(c => {
    if (c === 'Name*' || c === 'Description' || c === 'Highlights') return { wch: 42 }
    if (c.startsWith('Image')) return { wch: 35 }
    if (c === 'Parent SKU' || c === 'Color' || c === 'Size') return { wch: 22 }
    return { wch: 18 }
  })
  ws['!rows'] = [{ hpt: 22 }, { hpt: 18 }]
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  // Header cell styles
  TEMPLATE_COLS.forEach((col, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: i })
    if (!ws[cellRef]) return
    ws[cellRef].s = {
      font: { bold: true, color: { rgb: requiredCols.has(col) ? 'FFFFFF' : '1a202c' }, sz: 11 },
      fill: { fgColor: { rgb: requiredCols.has(col) ? 'DC2626' : col === 'Color' || col === 'Size' ? '4F46E5' : col.startsWith('Image') ? '0369A1' : '374151' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      border: { bottom: { style: 'thin', color: { rgb: 'CBD5E1' } } },
    }
    // White text for dark cols
    if (['Color','Size','Image 1','Image 2','Image 3','Image 4','Image 5','Image 6','Image 7','Image 8'].includes(col)) {
      ws[cellRef].s.font.color = { rgb: 'FFFFFF' }
    }
  })

  // Example row light style
  TEMPLATE_COLS.forEach((_, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: 1, c: i })
    if (!ws[cellRef]) return
    ws[cellRef].s = {
      font: { italic: true, color: { rgb: '64748b' }, sz: 10 },
      fill: { fgColor: { rgb: 'F8FAFC' }, patternType: 'solid' },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
    }
  })

  XLSX.utils.book_append_sheet(wb, ws, 'template')

  // ── Sheet 2: rules ──────────────────────────────────────────────────────────
  const rules = [
    ['CartUp Manual Upload — Template Rules', '', ''],
    ['', '', ''],
    ['COLUMN', 'REQUIRED?', 'HOW TO FILL'],
    ['Name*', 'YES ✅', 'Product name in English. Will be cleaned by AI (typo fix, duplicate removal).'],
    ['Parent SKU', 'YES ✅', 'Unique product code. Used as the base for Seller SKU generation. E.g. SWE77556'],
    ['Description', 'No', 'Product description text or HTML. AI will clean, format and remove boilerplate.'],
    ['Highlights', 'No', 'Key features. AI will format as bullet list, remove non-English characters.'],
    ['Image 1–8', 'No', 'Full image URL (https://...). Image 1 is the main image. Leave blank if no image.'],
    ['Brand', 'No', 'Brand name. Defaults to "No Brand" if empty.'],
    ['Color', 'No', 'Comma-separated colors. E.g. Black,Blue,Red → creates one row per color.'],
    ['Size', 'No', 'Comma-separated sizes. E.g. S,M,L or 40,42,44 → creates one row per size.'],
    ['Price', 'No', 'Regular / MRP price. Numbers only.'],
    ['Special Price', 'No', 'Discounted price (must be lower than Price).'],
    ['Special Start Date', 'No', 'Format: DD/MM/YYYY or MM/DD/YYYY'],
    ['Special End Date', 'No', 'Format: DD/MM/YYYY or MM/DD/YYYY'],
    ['Stock', 'No', 'Available stock quantity per SKU.'],
    ['Status', 'No', '"active" or "inactive". Defaults to blank.'],
    ['Weight(kg)', 'No', 'Package weight in kilograms. E.g. 0.5'],
    ['Length(cm)', 'No', 'Package length in centimeters.'],
    ['Width(cm)', 'No', 'Package width in centimeters.'],
    ['Height(cm)', 'No', 'Package height in centimeters.'],
    ['Warranty', 'No', 'E.g. "6 Months", "1 Year", "No Warranty"'],
    ['', '', ''],
    ['HOW VARIANT EXPANSION WORKS', '', ''],
    ['', '', ''],
    ['Example:', '', ''],
    ['  Name* = Dog Shampoo', '', ''],
    ['  Parent SKU = SWE77556', '', ''],
    ['  Color = Black,Blue', '', ''],
    ['  Size = S,M', '', ''],
    ['', '', ''],
    ['Result → 4 output rows:', '', ''],
    ['  SWE77556_Black_S', '', ''],
    ['  SWE77556_Black_M', '', ''],
    ['  SWE77556_Blue_S', '', ''],
    ['  SWE77556_Blue_M', '', ''],
    ['', '', ''],
    ['If only Color (no Size):', '', ''],
    ['  SWE77556_Black, SWE77556_Blue', '', ''],
    ['', '', ''],
    ['If no Color and no Size:', '', ''],
    ['  Seller SKU = Parent SKU (SWE77556)', '', ''],
    ['', '', ''],
    ['AI processes Name/Highlights/Description ONCE per Parent SKU (not per variant row).', '', ''],
    ['Category matching also runs once per Parent SKU.', '', ''],
  ]

  const wsR = XLSX.utils.aoa_to_sheet(rules)
  wsR['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 80 }]
  wsR['!rows'] = [{ hpt: 26 }]

  // Title style
  const titleCell = wsR['A1']
  if (titleCell) titleCell.s = { font: { bold: true, sz: 14, color: { rgb: '1a202c' } } }

  // Column header row style
  ;['A3','B3','C3'].forEach(ref => {
    if (!wsR[ref]) return
    wsR[ref].s = { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, fill: { fgColor: { rgb: '374151' }, patternType: 'solid' }, alignment: { horizontal: 'center' } }
  })

  // Required rows highlight
  const requiredRows = [3, 4] // 0-indexed rows 3,4 = Name*, Parent SKU data rows
  rules.forEach((row, ri) => {
    if (ri < 3) return
    const isRequired = row[1] === 'YES ✅'
    const isSectionTitle = row[0].toUpperCase() === row[0] && row[0].length > 3 && !row[0].startsWith(' ')
    ;['A','B','C'].forEach((col, ci) => {
      const ref = `${col}${ri + 1}`
      if (!wsR[ref]) return
      if (isRequired) {
        wsR[ref].s = { font: { bold: true, color: { rgb: ci === 1 ? '16a34a' : '1a202c' }, sz: 10 }, fill: { fgColor: { rgb: 'DCFCE7' }, patternType: 'solid' } }
      } else if (isSectionTitle) {
        wsR[ref].s = { font: { bold: true, sz: 11, color: { rgb: '4F46E5' } } }
      }
    })
  })

  XLSX.utils.book_append_sheet(wb, wsR, 'rules')

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}

export async function processManualFile(file, apiKey, onProgress) {
  onProgress('Reading file...')
  const rows = await readFile(file)
  if (!rows.length) throw new Error('File is empty or has no data rows')

  const cartupCategories = getCartupCategories()
  const invalidRows = []

  // ── Step 1: Parse rows, collect unique products, expand color×size ──────────
  onProgress('Parsing rows and expanding variants...')
  const uniqueProducts = {}   // parentSku → { pid, name, highlights, description }
  const expandedRows   = []   // one entry per output row (after color×size expansion)

  for (const row of rows) {
    const rawName      = col(row, 'name*', '**name (english)', 'name (english)', 'name', 'product name', '*product name', 'product name (english)', '*product name(english)', 'title')
    const rawHl        = col(row, 'highlights', '*highlights', 'highlight', 'key features', 'features')
    const rawDesc      = col(row, 'description', 'main description', '*description', 'product description', 'desc')
    const price        = col(row, '**price(mrp)', 'price(mrp)', 'mrp', 'price', '*price', 'sale price', 'selling price')
    const specialPrice = col(row, 'special price', 'specialprice', 'discounted price', 'offer price')
    const spStart      = col(row, 'special start date', 'special price start date', 'specialprice start', 'sp start')
    const spEnd        = col(row, 'special end date', 'special price end date', 'specialprice end', 'sp end')
    const parentSku    = col(row, 'parent sku', '*parent sku', 'parentsku', 'parent id')
    const brand        = col(row, '**brand', 'brand', '*brand') || 'No Brand'
    const stock        = col(row, '**stock', 'stock', '**current stock qty', 'quantity', '*quantity', 'current stock', 'qty')
    const status       = col(row, 'status')
    const colorRaw     = col(row, '*color', 'color', 'colour')
    const sizeRaw      = col(row, 'available sizes', 'size', 'sizes', 'clothing size', '*size')
    const img1         = col(row, '**product image 1', '*product image 1', 'product image 1', 'image 1', 'image1', 'image', 'images1', 'image url', 'image code')
    const img2         = col(row, 'product image 2', 'image 2', 'image2')
    const img3         = col(row, 'product image 3', 'image 3', 'image3')
    const img4         = col(row, 'product image 4', 'image 4', 'image4')
    const img5         = col(row, 'product image 5', 'image 5', 'image5')
    const img6         = col(row, 'product image 6', 'image 6', 'image6')
    const img7         = col(row, 'product image 7', 'image 7', 'image7')
    const img8         = col(row, 'product image 8', 'image 8', 'image8')
    const warranty     = col(row, 'warranty policy', 'warranty', 'warranty period', 'warranty type')
    const weight       = col(row, '**package weight (kg)', '*package weight (kg)', 'package weight', 'weight(kg)', 'weight (kg)', 'weight')
    const length       = col(row, '**package length(cm)', '*package length(cm)', 'package length', 'length(cm)', 'length (cm)', 'length')
    const width        = col(row, '*package width (cm)', 'package width', 'width(cm)', 'width (cm)', 'width')
    const height       = col(row, '*package height(cm)', 'package height', 'height(cm)', 'height (cm)', 'height')

    if (!rawName) {
      invalidRows.push({ 'Name':'', 'SKU':'', 'Parent SKU':parentSku, 'Price':price, 'Image 1':img1, 'Stock':stock, 'Status':status, 'Report':'Name missing' })
      continue
    }

    // Use parentSku as product key; fallback to a slugified name
    const pid = parentSku || rawName.replace(/\s+/g, '_').slice(0, 30)

    if (!uniqueProducts[pid]) {
      uniqueProducts[pid] = { pid, name: localFixName(rawName), highlights: rawHl, description: rawDesc }
    }

    // Expand color × size combinations
    const colors = splitVariants(colorRaw)
    const sizes  = splitVariants(sizeRaw)
    const colorList = colors.length ? colors : ['']
    const sizeList  = sizes.length  ? sizes  : ['']

    for (const colorVal of colorList) {
      for (const sizeVal of sizeList) {
        const sellerSku = buildSellerSku(pid, colorVal, sizeVal)
        expandedRows.push({
          pid, price, specialPrice, spStart, spEnd,
          brand, stock, status, warranty,
          img1, img2, img3, img4, img5, img6, img7, img8,
          weight, length, width, height,
          colorVal, sizeVal, sellerSku, parentSku: pid,
        })
      }
    }
  }

  const pidList = Object.values(uniqueProducts)
  if (!pidList.length) throw new Error('No valid rows found (Name missing in all rows)')

  // ── Step 2: Batch AI — name + highlights + description per unique product ───
  const aiCache = {}   // pid → { name, highlights, description }
  const BATCH_SIZE = 5

  if (apiKey) {
    const batches = []
    for (let i = 0; i < pidList.length; i += BATCH_SIZE) batches.push(pidList.slice(i, i + BATCH_SIZE))
    const totalBatches = batches.length
    const tasks = batches.map((batch, bi) => async () => {
      onProgress(`AI processing products ${bi * BATCH_SIZE + 1}–${Math.min((bi + 1) * BATCH_SIZE, pidList.length)} of ${pidList.length}...`)
      const result = await processProductsBatch(batch, apiKey)
      Object.assign(aiCache, result)
    })
    await runConcurrent(tasks, 3)
  } else {
    for (const p of pidList) {
      aiCache[p.pid] = { name: p.name, highlights: p.highlights || `<ul><li>${p.name}</li></ul>`, description: p.description || `<p>${p.name}</p>` }
    }
  }

  // ── Step 3: Batch category matching — one API call per 10 products ──────────
  const catMatchCache = {}  // pid → { cartupId, cartupPath, tags, reportNote }
  if (apiKey) {
    const CAT_BATCH = 10
    for (let i = 0; i < pidList.length; i += CAT_BATCH) {
      const batch = pidList.slice(i, i + CAT_BATCH)
      const batchProducts = batch.map(p => ({
        pid: p.pid,
        name: aiCache[p.pid]?.name || p.name || '',
      })).filter(p => p.name)

      if (!batchProducts.length) continue
      onProgress(`Matching categories for products ${i + 1}–${Math.min(i + CAT_BATCH, pidList.length)} of ${pidList.length}...`)

      const results = await matchCategoriesBatch(batchProducts, cartupCategories, apiKey)

      const batchError = results.__error__ || ''
      for (const p of batchProducts) {
        const matched = results[p.pid]
        if (matched && matched.id) {
          const cid = matched.id
          catMatchCache[p.pid] = { cartupId: cid, cartupPath: matched.path || '', tags: cartup_map[cid]?.tags || '', reportNote: '[AI] Category matched' }
        } else {
          const reason = batchError ? `API error: ${batchError}` : 'No category match found'
          catMatchCache[p.pid] = { cartupId: '', cartupPath: '', tags: '', reportNote: reason }
        }
      }
    }
  }

  // ── Step 4: Build output rows ─────────────────────────────────────────────
  onProgress('Building output rows...')
  const outputRows = []

  for (const r of expandedRows) {
    const ai = aiCache[r.pid] || { name: uniqueProducts[r.pid]?.name || '', highlights: '', description: '' }
    const cat = catMatchCache[r.pid] || { cartupId:'', cartupPath:'', tags:'', reportNote: apiKey ? 'No category match found' : 'No API key — category not matched' }
    const productName = ai.name || uniqueProducts[r.pid]?.name || ''
    const highlights = ensureHtmlHighlights(ai.highlights, productName)
    const description = ensureHtmlDescription(ai.description, productName)

    outputRows.push({
      '**Category Id':            cat.cartupId,
      '**Name (English)':         ai.name,
      'Name (Bengali)':           ai.name,
      '**Product Image 1':        r.img1,
      'Product Image 2':          r.img2,
      'Product Image 3':          r.img3,
      'Product Image 4':          r.img4,
      'Product Image 5':          r.img5,
      'Product Image 6':          r.img6,
      'Product Image 7':          r.img7,
      'Product Image 8':          r.img8,
      'VideoUrl':                 '',
      '**Brand':                  r.brand,
      '**Unit':                   'pcs',
      'Tags':                     cat.tags,
      'Clothing Materials':       '',
      'Shoe Material':            '',
      'Bag Material':             '',
      'Dial Materials':           '',
      'Strap Materials':          '',
      'Recommended Age':          '',
      'Watch Type':               '',
      'Main Materials':           '',
      'Highlights(English)':      highlights,
      'Highlights(Bengali)':      highlights,
      'Description (Bengali)':    description,
      'Description (English)':    description,
      "What's in the box":        `1* ${productName}`,
      'Warranty Policy(English)': r.warranty,
      'Warranty Policy(Bangla)':  r.warranty,
      'Warranty Type':            '',
      'Warranty Period':          '',
      '**Package Weight (kg)':    r.weight,
      '**Package Length(cm)':     r.length,
      '*Package Width (cm)':      r.width,
      '*Package Height(cm)':      r.height,
      'Clothing Size':            r.sizeVal,
      'Color':                    r.colorVal,
      'Model':                    '',
      'Age Group':                '',
      'Size':                     r.sizeVal,
      'Shoe Size':                '',
      'Bedding Size':             '',
      '**Seller SKU':             r.sellerSku,
      '**Parent Sku':             r.parentSku,
      '*Variant Image':           r.img1,
      '**Current Stock Qty':      r.stock,
      '**Price(MRP)':             r.price,
      'Special Price':            r.specialPrice,
      'Special Price Start Date': r.spStart,
      'Special Price End Date':   r.spEnd,
      'status':                   r.status,
      'Cartup Category Path':     cat.cartupPath,
      'Report':                   cat.reportNote,
    })
  }

  onProgress('Building Excel output...')
  return buildExcel(outputRows, invalidRows)
}

function buildExcel(rows, invalidRows = []) {
  const wb = XLSX.utils.book_new()

  const wsData = []
  const secRow = []
  for (const sec of SECTIONS) {
    secRow.push(sec.name)
    for (let i = 1; i < sec.cols; i++) secRow.push('')
  }
  wsData.push(secRow)
  wsData.push(OUTPUT_COLS)
  for (const r of rows) {
    wsData.push(OUTPUT_COLS.map(c => r[c] ?? ''))
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = OUTPUT_COLS.map(c => {
    if (c.includes('Name') || c.includes('Path') || c.includes('Report')) return { wch: 50 }
    if (c.includes('Image') || c.includes('Highlights') || c.includes('Description')) return { wch: 40 }
    return { wch: 20 }
  })
  ws['!freeze'] = { xSplit: 0, ySplit: 2 }
  XLSX.utils.book_append_sheet(wb, ws, 'product')

  if (invalidRows.length > 0) {
    const invCols = ['Name','SKU','Parent SKU','Price','Image 1','Stock','Status','Report']
    const invData = [invCols]
    for (const r of invalidRows) invData.push(invCols.map(c => r[c] ?? ''))
    const wsInv = XLSX.utils.aoa_to_sheet(invData)
    wsInv['!cols'] = invCols.map(c => c === 'Report' ? { wch: 55 } : c === 'Name' ? { wch: 40 } : { wch: 20 })
    wsInv['!freeze'] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(wb, wsInv, 'invalid')
  }

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
