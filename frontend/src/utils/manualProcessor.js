import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'
import { fixName, fixHighlights, fixDescription, matchCategory } from './gemini'

const { cartup_map } = MAPPINGS

const SECTIONS = [
  { name: 'Basic Information',   color: 'FFD9E1F2', cols: 15 },
  { name: 'Product Attribute',   color: 'FFE2EFDA', cols: 8  },
  { name: 'Product Description', color: 'FFFCE4D6', cols: 5  },
  { name: 'Service',             color: 'FFFFF2CC', cols: 4  },
  { name: 'Delivery',            color: 'FFDDEBF7', cols: 4  },
  { name: 'Variant Attribute',   color: 'FFF2F2F2', cols: 11 },
  { name: 'Extra',               color: 'FFEDEDED', cols: 4  },
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
  'Price','status','Cartup Category Path','Report'
]

// Flexible column finder — tries multiple common header names
function col(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(h => h.toLowerCase().trim() === k.toLowerCase())
    if (found && row[found] !== undefined && row[found] !== '') return String(row[found]).trim()
  }
  return ''
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

export async function processManualFile(file, apiKey, onProgress) {
  onProgress('Reading file...')
  const rows = await readFile(file)

  if (!rows.length) throw new Error('File is empty or has no data rows')

  const cartupCategories = getCartupCategories()
  const outputRows = []
  const total = rows.length

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    onProgress(`Processing row ${i + 1} of ${total}...`)

    const rawName   = col(row, 'name', 'product name', '*product name', 'product name (english)', '*product name(english)', 'title')
    const rawHl     = col(row, 'highlights', '*highlights', 'highlight', 'key features', 'features')
    const rawDesc   = col(row, 'description', 'main description', '*description', 'product description', 'desc')
    const price     = col(row, 'price', '*price', 'special price', 'sale price', 'selling price')
    const sku       = col(row, 'sku', 'seller sku', '*seller sku', 'sellersku', 'item sku')
    const parentSku = col(row, 'parent sku', '*parent sku', 'parentsku', 'parent id', 'product id')
    const brand     = col(row, 'brand', '*brand') || 'No Brand'
    const stock     = col(row, 'stock', 'quantity', '*quantity', 'current stock', '*current stock qty', 'qty')
    const status    = col(row, 'status')
    const img1      = col(row, 'image', 'image 1', 'image1', 'product image 1', '*product image 1', 'images1', 'image url')
    const img2      = col(row, 'image 2', 'image2', 'product image 2')
    const img3      = col(row, 'image 3', 'image3', 'product image 3')
    const img4      = col(row, 'image 4', 'image4', 'product image 4')
    const img5      = col(row, 'image 5', 'image5', 'product image 5')
    const img6      = col(row, 'image 6', 'image6', 'product image 6')
    const img7      = col(row, 'image 7', 'image7', 'product image 7')
    const img8      = col(row, 'image 8', 'image8', 'product image 8')
    const warranty  = col(row, 'warranty policy', 'warranty', 'warranty period')
    const weight    = col(row, 'package weight', '*package weight (kg)', 'weight')
    const length    = col(row, 'package length', '*package length(cm)', 'length')
    const width     = col(row, 'package width', '*package width (cm)', 'width')
    const height    = col(row, 'package height', '*package height(cm)', 'height')

    if (!rawName) {
      outputRows.push({ ...Object.fromEntries(OUTPUT_COLS.map(c => [c, ''])), Report: 'Skipped — no Name' })
      continue
    }

    // Step 1: Fix name
    let fixedName = rawName
    if (apiKey) {
      onProgress(`[${i+1}/${total}] Fixing name: ${rawName.slice(0,40)}...`)
      fixedName = await fixName(rawName, apiKey)
    }

    // Step 2: AI category match
    let cartupId = '', cartupPath = '', tags = '', reportNote = ''
    if (apiKey && fixedName) {
      onProgress(`[${i+1}/${total}] Matching category...`)
      const matched = await matchCategory(fixedName, cartupCategories, apiKey)
      if (matched) {
        cartupId   = matched.id || ''
        cartupPath = matched.path || ''
        tags       = cartup_map[cartupId]?.tags || ''
        reportNote = `[AI] ${matched.reason || 'AI matched'}`
      } else {
        reportNote = 'No category match found'
      }
    } else {
      reportNote = 'No API key — category not matched'
    }

    // Step 3: Fix highlights
    let highlights = rawHl
    if (apiKey) {
      onProgress(`[${i+1}/${total}] Fixing highlights...`)
      highlights = await fixHighlights(rawHl, fixedName, rawDesc, apiKey)
    }

    // Step 4: Fix description
    let description = rawDesc
    if (apiKey) {
      onProgress(`[${i+1}/${total}] Fixing description...`)
      description = await fixDescription(rawDesc, fixedName, highlights, apiKey)
    }

    outputRows.push({
      '**Category Id':            cartupId,
      '**Name (English)':         fixedName,
      'Name (Bengali)':           fixedName,
      '**Product Image 1':        img1,
      'Product Image 2':          img2,
      'Product Image 3':          img3,
      'Product Image 4':          img4,
      'Product Image 5':          img5,
      'Product Image 6':          img6,
      'Product Image 7':          img7,
      'Product Image 8':          img8,
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
      'Highlights(English)':      highlights,
      'Highlights(Bengali)':      highlights,
      'Description (Bengali)':    description,
      'Description (English)':    description,
      "What's in the box":        `1* ${fixedName}`,
      'Warranty Policy(English)': warranty,
      'Warranty Policy(Bangla)':  warranty,
      'Warranty Type':            '',
      'Warranty Period':          '',
      '**Package Weight (kg)':    weight,
      '**Package Length(cm)':     length,
      '*Package Width (cm)':      width,
      '*Package Height(cm)':      height,
      'Clothing Size':            '',
      'Color':                    '',
      'Model':                    '',
      'Age Group':                '',
      'Size':                     '',
      'Shoe Size':                '',
      'Bedding Size':             '',
      '**Seller SKU':             sku,
      '**Parent Sku':             parentSku,
      '*Variant Image':           img1,
      '**Current Stock Qty':      stock,
      'Price':                    price,
      'status':                   status,
      'Cartup Category Path':     cartupPath,
      'Report':                   reportNote,
    })
  }

  onProgress('Building Excel output...')
  return buildExcel(outputRows)
}

function buildExcel(rows) {
  const wb = XLSX.utils.book_new()
  const wsData = []

  // Row 1: section headers
  const secRow = []
  for (const sec of SECTIONS) {
    secRow.push(sec.name)
    for (let i = 1; i < sec.cols; i++) secRow.push('')
  }
  // extra cols (Price, status, path, report)
  secRow.push('Extra', '', '', '')
  wsData.push(secRow)

  // Row 2: column headers
  wsData.push(OUTPUT_COLS)

  // Data rows
  for (const r of rows) {
    wsData.push(OUTPUT_COLS.map(col => r[col] ?? ''))
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  ws['!cols'] = OUTPUT_COLS.map(col => {
    if (col.includes('Name') || col.includes('Path') || col.includes('Report')) return { wch: 50 }
    if (col.includes('Image') || col.includes('Highlights') || col.includes('Description')) return { wch: 40 }
    return { wch: 20 }
  })

  ws['!freeze'] = { xSplit: 0, ySplit: 2 }

  XLSX.utils.book_append_sheet(wb, ws, 'product')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
