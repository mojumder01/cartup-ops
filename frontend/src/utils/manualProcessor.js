import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'
import { processProductsBatch, matchCategory, localFixName, runConcurrent } from './gemini'

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
  const exampleRow = [
    'My Product Name','Product description here','• Feature 1\n• Feature 2',
    'https://image1.jpg','','','','','','','',
    'My Brand','SWE77556','Black,Blue,Red','40,42,44',
    '999','799','01/01/2025','31/12/2025',
    '10','active',
    '0.5','20','15','5',
    '6 Months',
  ]
  const wsData = [TEMPLATE_COLS, exampleRow]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = TEMPLATE_COLS.map(c => {
    if (c === 'Name*' || c === 'Description' || c === 'Highlights') return { wch: 40 }
    if (c.startsWith('Image')) return { wch: 35 }
    return { wch: 18 }
  })
  XLSX.utils.book_append_sheet(wb, ws, 'template')
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

  // ── Step 3: Collect unique names for category matching ───────────────────────
  const catMatchCache = {}  // pid → { cartupId, cartupPath, tags, reportNote }
  if (apiKey) {
    const uniquePidsForCat = pidList.map(p => p.pid)
    const catTasks = uniquePidsForCat.map(pid => async () => {
      const fixedName = aiCache[pid]?.name || uniqueProducts[pid]?.name || ''
      if (!fixedName) { catMatchCache[pid] = { cartupId:'', cartupPath:'', tags:'', reportNote:'No name for category match' }; return }
      onProgress(`Matching category for: ${fixedName.slice(0, 40)}...`)
      const matched = await matchCategory(fixedName, cartupCategories, apiKey)
      if (matched) {
        const cid = matched.id || ''
        catMatchCache[pid] = { cartupId: cid, cartupPath: matched.path || '', tags: cartup_map[cid]?.tags || '', reportNote: `[AI] ${matched.reason || 'AI matched'}` }
      } else {
        catMatchCache[pid] = { cartupId:'', cartupPath:'', tags:'', reportNote:'No category match found' }
      }
    })
    await runConcurrent(catTasks, 3)
  }

  // ── Step 4: Build output rows ─────────────────────────────────────────────
  onProgress('Building output rows...')
  const outputRows = []

  for (const r of expandedRows) {
    const ai = aiCache[r.pid] || { name: uniqueProducts[r.pid]?.name || '', highlights: '', description: '' }
    const cat = catMatchCache[r.pid] || { cartupId:'', cartupPath:'', tags:'', reportNote: apiKey ? 'No category match found' : 'No API key — category not matched' }

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
      'Highlights(English)':      ai.highlights,
      'Highlights(Bengali)':      ai.highlights,
      'Description (Bengali)':    ai.description,
      'Description (English)':    ai.description,
      "What's in the box":        `1* ${ai.name}`,
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
