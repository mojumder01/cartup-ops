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

  // Build image map: parentSku → { color → [img1..img8], noColor → [img1..img8] }
  onProgress('Mapping SKU images...')
  const imageMap = {}  // parentSku → array of { color, imgs[] }

  for (const row of skuimgRows) {
    const parentSku = col(row,
      'parent sku', 'parentsku', 'parent_sku', 'parent id', 'parentid',
      '**parent sku', '*parent sku',
    )
    const sellerSku = col(row,
      'seller sku', 'sellersku', 'seller_sku', 'sku', '**seller sku', '*seller sku',
    )
    const color = col(row, 'color', 'colour', '*color')

    const imgs = [
      col(row, 'image 1','image1','**product image 1','*product image 1','product image 1','img1','image url','main image'),
      col(row, 'image 2','image2','product image 2','img2'),
      col(row, 'image 3','image3','product image 3','img3'),
      col(row, 'image 4','image4','product image 4','img4'),
      col(row, 'image 5','image5','product image 5','img5'),
      col(row, 'image 6','image6','product image 6','img6'),
      col(row, 'image 7','image7','product image 7','img7'),
      col(row, 'image 8','image8','product image 8','img8'),
    ]

    const pid = parentSku || (sellerSku ? sellerSku.split('_')[0] : '')
    if (!pid) continue

    if (!imageMap[pid]) imageMap[pid] = []
    imageMap[pid].push({ color, sellerSku, imgs })
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

    const entries = imageMap[parentSku]
    if (!entries || !entries.length) {
      // No image data found — output one empty row
      outputRows.push({
        'Parent SKU': parentSku,
        'Seller SKU': parentSku,
        'Image 1': '', 'Image 2': '', 'Image 3': '', 'Image 4': '',
        'Image 5': '', 'Image 6': '', 'Image 7': '', 'Image 8': '',
        'Variant Image': '',
        'Variant Combo': '',
      })
      continue
    }

    for (const entry of entries) {
      const variantCombo = entry.color ? `Color:${entry.color}` : ''
      const sellerSku = entry.sellerSku || (entry.color ? `${parentSku}_${entry.color}` : parentSku)
      outputRows.push({
        'Parent SKU':   parentSku,
        'Seller SKU':   sellerSku,
        'Image 1':      entry.imgs[0] || '',
        'Image 2':      entry.imgs[1] || '',
        'Image 3':      entry.imgs[2] || '',
        'Image 4':      entry.imgs[3] || '',
        'Image 5':      entry.imgs[4] || '',
        'Image 6':      entry.imgs[5] || '',
        'Image 7':      entry.imgs[6] || '',
        'Image 8':      entry.imgs[7] || '',
        'Variant Image': entry.imgs[0] || '',
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
