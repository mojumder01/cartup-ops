import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'
import { fixName, fixHighlights, fixDescription, matchCategory } from './gemini'

const { daraz_to_cartup, cartup_map, cat_variant_map, mystery_cats, manual_cats } = MAPPINGS

const VARIANT_COLS = [
  'Clothing Materials','Shoe Material','Bag Material','Dial Materials',
  'Strap Materials','Main Materials','Recommended Age','Watch TYespe',
  'Clothing Size','Age Group','Shoe Size','Size','Color','Bedding Size','Model'
]

const SECTIONS = [
  { name: 'Basic Information',   color: 'FFD9E1F2', cols: 15 },
  { name: 'Product Attribute',   color: 'FFE2EFDA', cols: 8  },
  { name: 'Product Description', color: 'FFFCE4D6', cols: 5  },
  { name: 'Service',             color: 'FFFFF2CC', cols: 4  },
  { name: 'Delivery',            color: 'FFDDEBF7', cols: 4  },
  { name: 'Variant Attribute',   color: 'FFF2F2F2', cols: 15 },
  { name: 'Extra',               color: 'FFEDEDED', cols: 4  },
]

const OUTPUT_COLS = [
  '**Category Id','**Name (English)','Name (Bengali)',
  '**Product Image 1','Product Image 2','Product Image 3','Product Image 4',
  'Product Image 5','Product Image 6','Product Image 7','Product Image 8',
  'VideoUrl','**Brand','**Unit','Tags',
  'Clothing Materials','Shoe Material','Bag Material','Dial Materials',
  'Strap Materials','Recommended Age','Watch Type','Main Materials',
  'Highlights(English)','Highlights(Bengali)','Description (Bengali)','Description (English)',"What's in the box",
  'Warranty Policy(English)','Warranty Policy(Bangla)','Warranty Type','Warranty Period',
  '**Package Weight (kg)','**Package Length(cm)','*Package Width (cm)','*Package Height(cm)',
  'Clothing Size','Color','Model','Age Group','Size','Shoe Size','Bedding Size',
  '**Seller SKU','**Parent Sku','*Variant Image','**Current Stock Qty',
  '**Price(MRP)','Special Price','Special Price Start Date','Special Price End Date',
  'status','Cartup Category Path','Variations Combo','Report'
]

function readSheet(file, sheetName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]]
        if (!ws) { reject(new Error(`Sheet "${sheetName}" not found`)); return }
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        resolve(rows)
      } catch(err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function readAllSheets(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const result = {}
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name]
          result[name] = XLSX.utils.sheet_to_json(ws, { defval: '', range: 1 })
        }
        resolve(result)
      } catch(err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function cleanHtml(html, allowedTags) {
  if (!html) return ''
  // Remove img tags
  let clean = String(html).replace(/<img[^>]*>/gi, '')
  // Remove disallowed tags but keep content
  const allowed = allowedTags.join('|')
  clean = clean.replace(new RegExp(`<(?!\/?(?:${allowed})(?:\s|>|\/))([^>]*)>`, 'gi'), '')
  return clean.trim()
}

function cleanHighlights(html) {
  if (!html) return ''
  const clean = cleanHtml(html, ['ul','li'])
  if (clean.includes('<li>')) return clean
  // Extract text and wrap
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const lines = text.split(/[•\n]/).map(l => l.trim()).filter(Boolean)
  return '<ul>' + lines.map(l => `<li>${l}</li>`).join('') + '</ul>'
}

function cleanDescription(html) {
  if (!html) return ''
  const clean = cleanHtml(html, ['p'])
  if (clean.includes('<p>')) return clean
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? `<p>${text}</p>` : ''
}

function parseVariations(combo, applicable) {
  const result = Object.fromEntries(VARIANT_COLS.map(c => [c, '']))
  if (!combo) return result
  const parts = combo.split(',')
  const color = parts[0]?.trim() || ''
  const sizeVal = parts.slice(1).join(',').trim() || 'Yes'
  if (applicable?.includes('Color')) result['Color'] = color
  if (sizeVal) {
    if (applicable?.includes('Shoe Size')) result['Shoe Size'] = sizeVal
    else if (applicable?.includes('Clothing Size')) result['Clothing Size'] = sizeVal
    else if (applicable?.includes('Bedding Size')) result['Bedding Size'] = sizeVal
    else if (applicable?.includes('Size')) result['Size'] = sizeVal
    else result['Size'] = sizeVal
  }
  return result
}

function getCartupCategories() {
  return Object.entries(cartup_map).map(([id, v]) => ({ id, path: v.path }))
}

export async function processDarazFiles(files, apiKey, onProgress) {
  onProgress('Reading files...')

  const [priceRows, basicRows, freightRows, skuimgRows] = await Promise.all([
    readSheet(files.price, 'template'),
    readSheet(files.basic, 'template'),
    readSheet(files.weight, 'template'),
    readSheet(files.skuimg, 'template'),
  ])

  let brandDict = {}
  if (files.attr) {
    const attrSheets = await readAllSheets(files.attr)
    for (const [sheetName, rows] of Object.entries(attrSheets)) {
      if (sheetName === 'INDEX') continue
      for (const row of rows) {
        const pid = String(row['Product ID'] || '').trim()
        const brand = String(row['*Brand'] || row['Brand'] || '').trim()
        if (pid && !brandDict[pid]) brandDict[pid] = brand || 'No Brand'
      }
    }
  }

  // Build lookup dicts
  const basicDict = {}
  for (const r of basicRows) {
    const pid = String(r['Product ID'] || '').trim()
    if (pid && !basicDict[pid]) basicDict[pid] = r
  }
  const freightDict = {}
  for (const r of freightRows) {
    const pid = String(r['Product ID'] || '').trim()
    if (pid && !freightDict[pid]) freightDict[pid] = r
  }
  const skuDict = {}
  for (const r of skuimgRows) {
    const sku = String(r['SellerSKU'] || '').trim()
    if (sku && !skuDict[sku]) skuDict[sku] = r
  }

  const cartupCategories = getCartupCategories()
  const outputRows = []
  const total = priceRows.length

  for (let i = 0; i < priceRows.length; i++) {
    const row = priceRows[i]
    onProgress(`Processing row ${i + 1} of ${total}...`)

    const pid   = String(row['Product ID'] || '').trim()
    const cat   = String(row['catId'] || '').trim()
    const name  = String(row['*Product Name(English)'] || '').trim()
    const sku   = String(row['SellerSKU'] || '').trim()
    const combo = String(row['Variations Combo'] || '').trim()
    const status = String(row['status'] || '').trim()

    const brand = brandDict[pid] || 'No Brand'

    // Category mapping
    let cartupId = '', cartupPath = '', tags = '', reportNote = ''
    const isMystery = mystery_cats.includes(cat)

    if (isMystery) {
      reportNote = 'Mystery/Surprise Box — no category. Manual review needed.'
    } else {
      cartupId = daraz_to_cartup[cat] || ''
      if (cartupId) {
        cartupPath = cartup_map[cartupId]?.path || ''
        tags = cartup_map[cartupId]?.tags || ''
        reportNote = manual_cats.includes(cat) ? `Manually mapped (Daraz catId=${cat})` : 'OK'
      } else {
        // AI category match
        if (apiKey && name) {
          onProgress(`AI matching category for: ${name.slice(0, 40)}...`)
          const matched = await matchCategory(name, cartupCategories, apiKey)
          if (matched) {
            cartupId   = matched.id || ''
            cartupPath = matched.path || ''
            tags       = cartup_map[cartupId]?.tags || ''
            reportNote = `[AI] ${matched.reason || 'AI matched'}`
          } else {
            reportNote = `No category match for Daraz catId=${cat}`
          }
        } else {
          reportNote = `No category match for Daraz catId=${cat}`
        }
      }
    }

    const applicable = cat_variant_map[cartupId] || []
    const b = basicDict[pid] || {}
    const f = freightDict[pid] || {}
    const s = skuDict[sku] || {}

    // Name fix
    let fixedName = name
    if (apiKey && name) {
      onProgress(`Fixing name ${i + 1}/${total}...`)
      fixedName = await fixName(name, apiKey)
    }

    // Content
    let highlights  = cleanHighlights(String(b['*Highlights'] || ''))
    let description = cleanDescription(String(b['Main Description'] || ''))

    if (apiKey) {
      onProgress(`AI processing content ${i + 1}/${total}...`)
      highlights  = await fixHighlights(highlights, fixedName, description, apiKey)
      description = await fixDescription(description, fixedName, highlights, apiKey)
    } else {
      // No AI — basic logic
      if (!highlights && !description) {
        highlights  = `<ul><li>${fixedName}</li></ul>`
        description = `<p>${fixedName}</p>`
      } else if (!highlights) {
        const text = description.replace(/<[^>]+>/g, ' ').trim()
        highlights = `<ul><li>${fixedName}</li><li>${text.slice(0, 200)}</li></ul>`
      } else if (!description) {
        const text = highlights.replace(/<[^>]+>/g, ' ').trim()
        description = `<p>${fixedName}. ${text.slice(0, 300)}</p>`
      }
    }

    const vr = parseVariations(combo, applicable)
    const warrantyPolicy = String(b['Warranty Policy'] || '').trim()
    const warrantyTypeCol = b['*Warranty Type'] !== undefined ? '*Warranty Type' : 'Warranty Type'

    const images = Array.from({length: 8}, (_, i) => {
      const k = i === 0 ? '*Product Images1' : `Product Images${i + 1}`
      return String(b[k] || '').trim()
    })

    outputRows.push({
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
      'Clothing Materials':       vr['Clothing Materials'],
      'Shoe Material':            vr['Shoe Material'],
      'Bag Material':             vr['Bag Material'],
      'Dial Materials':           vr['Dial Materials'],
      'Strap Materials':          vr['Strap Materials'],
      'Recommended Age':          vr['Recommended Age'],
      'Watch Type':               vr['Watch TYespe'],
      'Main Materials':           vr['Main Materials'],
      'Highlights(English)':      highlights,
      'Highlights(Bengali)':      highlights,
      'Description (Bengali)':    description,
      'Description (English)':    description,
      "What's in the box":        `1* ${fixedName}`,
      'Warranty Policy(English)': warrantyPolicy,
      'Warranty Policy(Bangla)':  warrantyPolicy,
      'Warranty Type':            String(b[warrantyTypeCol] || '').trim(),
      'Warranty Period':          String(b['Warranty'] || '').trim(),
      '**Package Weight (kg)':    String(f['*Package Weight (kg)'] || '').trim(),
      '**Package Length(cm)':     String(f['*Package Length (cm)'] || '').trim(),
      '*Package Width (cm)':      String(f['*Package Width (cm)'] || '').trim(),
      '*Package Height(cm)':      String(f['*Package Height (cm)'] || '').trim(),
      'Clothing Size':            vr['Clothing Size'],
      'Color':                    vr['Color'],
      'Model':                    vr['Model'],
      'Age Group':                vr['Age Group'],
      'Size':                     vr['Size'],
      'Shoe Size':                vr['Shoe Size'],
      'Bedding Size':             vr['Bedding Size'],
      '**Seller SKU':             sku,
      '**Parent Sku':             pid,
      '*Variant Image':           String(s['Images1'] || '').trim(),
      '**Current Stock Qty':      String(row['*Quantity'] || '').trim(),
      '**Price(MRP)':            String(row['**Price(MRP)'] || row['Price'] || '').trim(),
      'Special Price':            String(row['Special Price'] || row['SpecialPrice'] || '').trim(),
      'Special Price Start Date': String(row['Special Price Start Date'] || '').trim(),
      'Special Price End Date':   String(row['Special Price End Date'] || '').trim(),
      'status':                   status,
      'Cartup Category Path':     cartupPath,
      'Variations Combo':         combo,
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
  wsData.push(secRow)

  // Row 2: column headers
  wsData.push(OUTPUT_COLS)

  // Data rows
  for (const r of rows) {
    wsData.push(OUTPUT_COLS.map(col => r[col] ?? ''))
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Column widths
  ws['!cols'] = OUTPUT_COLS.map((col, i) => {
    if (i === 2 || i === 3) return { wch: 50 }
    if (col === 'Report' || col === 'Cartup Category Path') return { wch: 45 }
    return { wch: 20 }
  })

  // Freeze row 3
  ws['!freeze'] = { xSplit: 0, ySplit: 2 }

  XLSX.utils.book_append_sheet(wb, ws, 'product')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
