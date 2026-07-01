import * as XLSX from 'xlsx'

const OUTPUT_COLS = [
  'Parent SKU', 'Seller SKU',
  'Image 1', 'Image 2', 'Image 3', 'Image 4',
  'Image 5', 'Image 6', 'Image 7', 'Image 8',
  'Variant Image', 'Variant Combo',
]

function readSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function col(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(h => h.toLowerCase().trim() === k.toLowerCase())
    if (found && row[found] !== undefined && row[found] !== '') return String(row[found]).trim()
  }
  return ''
}

export async function processVisualFiles(skuimgFile, basicFile, onProgress) {
  onProgress('Reading files...')

  const [skuimgRows, basicRows] = await Promise.all([
    readSheet(skuimgFile),
    readSheet(basicFile),
  ])

  // Build skuimg lookup: SellerSKU → row
  // Also build parentSku → [{ sellerSku, color, skuImg }]
  onProgress('Mapping SKU images...')

  const skuDict = {}       // sellerSku → skuimg row
  const parentEntries = {} // parentSku → [{ sellerSku, color, skuImg }]

  for (const row of skuimgRows) {
    const sellerSku = col(row,
      'sellersku', 'seller sku', 'seller_sku', 'sku', '**seller sku', '*seller sku',
    )
    const parentSku = col(row,
      'parent sku', 'parentsku', 'parent_sku', 'parent id', '**parent sku', '*parent sku',
    )
    const color = col(row, 'color', 'colour', '*color')
    // Variant image from skuimg file — same column name as Daraz: Images1
    const skuImg = col(row, 'images1', 'image1', 'image 1', '*product images1', 'variant image', 'variantimage')

    if (sellerSku) skuDict[sellerSku] = row

    const pid = parentSku || (sellerSku ? sellerSku.split('_')[0] : '')
    if (!pid) continue

    if (!parentEntries[pid]) parentEntries[pid] = []
    parentEntries[pid].push({ sellerSku, color, skuImg })
  }

  // Build output rows from basic file
  onProgress('Building output rows...')
  const outputRows = []

  for (const row of basicRows) {
    const parentSku = col(row,
      'parent sku', 'parentsku', 'parent_sku', 'parent id',
      '**parent sku', '*parent sku',
    )
    if (!parentSku) continue

    // Images from basic file (same logic as Daraz processor)
    const basicImages = Array.from({ length: 8 }, (_, idx) => {
      if (idx === 0) return col(row, '*product images1', 'product images1', 'product image 1', '*product image 1', 'image 1', 'image1', 'images1', 'main image')
      return col(row, `product images${idx + 1}`, `product image ${idx + 1}`, `image ${idx + 1}`, `image${idx + 1}`)
    })

    const entries = parentEntries[parentSku]

    if (!entries || !entries.length) {
      // No skuimg data — one row, no variant image for color, fallback img1
      outputRows.push({
        'Parent SKU':    parentSku,
        'Seller SKU':    parentSku,
        'Image 1':       basicImages[0], 'Image 2': basicImages[1],
        'Image 3':       basicImages[2], 'Image 4': basicImages[3],
        'Image 5':       basicImages[4], 'Image 6': basicImages[5],
        'Image 7':       basicImages[6], 'Image 8': basicImages[7],
        'Variant Image': basicImages[0],
        'Variant Combo': '',
      })
      continue
    }

    for (const entry of entries) {
      const hasColor = !!entry.color
      const variantCombo = hasColor ? `Color:${entry.color}` : ''
      const sellerSku = entry.sellerSku || (hasColor ? `${parentSku}_${entry.color}` : parentSku)

      // Same rule as Daraz:
      // skuImg present → use it as variant image
      // no skuImg + color variant → leave empty (missing)
      // no skuImg + no color → fallback to basic Image 1
      const variantImage = entry.skuImg || (hasColor ? '' : basicImages[0])

      outputRows.push({
        'Parent SKU':    parentSku,
        'Seller SKU':    sellerSku,
        'Image 1':       basicImages[0], 'Image 2': basicImages[1],
        'Image 3':       basicImages[2], 'Image 4': basicImages[3],
        'Image 5':       basicImages[4], 'Image 6': basicImages[5],
        'Image 7':       basicImages[6], 'Image 8': basicImages[7],
        'Variant Image': variantImage,
        'Variant Combo': variantCombo,
      })
    }
  }

  onProgress('Building Excel output...')

  const wb = XLSX.utils.book_new()
  const wsData = [OUTPUT_COLS, ...outputRows.map(r => OUTPUT_COLS.map(c => r[c] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = OUTPUT_COLS.map(c =>
    c.includes('SKU') ? { wch: 28 } : c.includes('Image') || c.includes('Combo') ? { wch: 40 } : { wch: 20 }
  )
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, ws, 'visual')

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
