import * as XLSX from 'xlsx'

const OUTPUT_COLS = [
  'Parent SKU', 'Product', 'Seller SKU',
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

  // Build basic lookup: productId → { name, images[8] }
  onProgress('Mapping basic file...')
  const basicDict = {}
  for (const row of basicRows) {
    const pid = col(row, 'product id', 'productid', 'parent sku', 'parentsku', 'parent id')
    if (!pid) continue
    const images = Array.from({ length: 8 }, (_, i) => {
      if (i === 0) return col(row, '*product images1', 'product images1', 'product image 1', '*product image 1', 'image 1', 'image1', 'images1')
      return col(row, `product images${i + 1}`, `product image ${i + 1}`, `image ${i + 1}`, `image${i + 1}`)
    })
    basicDict[pid] = {
      name:   col(row, '*product name(english)', 'product name(english)', '*product name', 'name', 'product name'),
      images,
    }
  }

  // Group skuimg rows by productId
  onProgress('Mapping SKU images...')
  const skuGroups = {} // productId → [{ sellerSku, skuImages[8], variantCombo }]

  for (const row of skuimgRows) {
    const pid = col(row, 'product id', 'productid', 'parent sku', 'parentsku')
    if (!pid) continue

    const sellerSku    = col(row, 'sellersku', 'seller sku', 'seller_sku', 'shop sku', 'sku')
    const variantCombo = col(row, 'variations combo', 'variationscombo', 'variant combo', 'variantcombo', 'color', 'colour')

    const skuImages = Array.from({ length: 8 }, (_, i) =>
      col(row, `images${i + 1}`, `image${i + 1}`, `image ${i + 1}`)
    )

    if (!skuGroups[pid]) skuGroups[pid] = []
    skuGroups[pid].push({ sellerSku, skuImages, variantCombo })
  }

  // Build output rows
  onProgress('Building output rows...')
  const outputRows = []

  // Iterate in basic file order
  for (const row of basicRows) {
    const pid = col(row, 'product id', 'productid', 'parent sku', 'parentsku', 'parent id')
    if (!pid) continue

    const basic   = basicDict[pid] || { name: '', images: Array(8).fill('') }
    const entries = skuGroups[pid]

    if (!entries || !entries.length) {
      outputRows.push({
        'Parent SKU':    pid,
        'Product':       basic.name,
        'Seller SKU':    pid,
        'Image 1':       basic.images[0], 'Image 2': basic.images[1],
        'Image 3':       basic.images[2], 'Image 4': basic.images[3],
        'Image 5':       basic.images[4], 'Image 6': basic.images[5],
        'Image 7':       basic.images[6], 'Image 8': basic.images[7],
        'Variant Image': basic.images[0],
        'Variant Combo': '',
      })
      continue
    }

    for (const entry of entries) {
      const hasVariant = !!entry.variantCombo
      const skuImg     = entry.skuImages[0]

      // Same rule as Daraz processor:
      // skuImg present → use it as variant image
      // variant exists but no skuImg → leave empty
      // no variant → fallback to basic Image 1
      const variantImage = skuImg || (hasVariant ? '' : basic.images[0])

      outputRows.push({
        'Parent SKU':    pid,
        'Product':       basic.name,
        'Seller SKU':    entry.sellerSku || pid,
        'Image 1':       basic.images[0], 'Image 2': basic.images[1],
        'Image 3':       basic.images[2], 'Image 4': basic.images[3],
        'Image 5':       basic.images[4], 'Image 6': basic.images[5],
        'Image 7':       basic.images[6], 'Image 8': basic.images[7],
        'Variant Image': variantImage,
        'Variant Combo': entry.variantCombo,
      })
    }
  }

  onProgress('Building Excel output...')

  const wb = XLSX.utils.book_new()
  const wsData = [OUTPUT_COLS, ...outputRows.map(r => OUTPUT_COLS.map(c => r[c] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = OUTPUT_COLS.map(c =>
    c === 'Product' ? { wch: 50 }
    : c.includes('SKU') ? { wch: 28 }
    : c.includes('Image') || c.includes('Combo') ? { wch: 40 }
    : { wch: 20 }
  )
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, ws, 'visual')

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
