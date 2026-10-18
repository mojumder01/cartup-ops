import { useState } from 'react'
import * as XLSX from 'xlsx'
import { duplicateShop, readSellerExport, prefixedSku, zipFiles } from '../utils/shopDuplicate'
import { Copy, FileSpreadsheet, CheckCircle, AlertCircle, AlertTriangle, Loader, Download, Info } from 'lucide-react'

function FileInput({ label, hint, onChange, summary }) {
  const [fileName, setFileName] = useState('')
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px' }}>
        {label} <span style={{ color:'#dc2626' }}>*</span>
      </label>
      {hint && <div style={{ fontSize:11, color:'#94a3b8', marginBottom:6 }}>{hint}</div>}
      <label className="file-drop" style={{
        display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        border:`1.5px dashed ${fileName ? '#16a34a' : '#e2e8f0'}`,
        borderRadius:8, cursor:'pointer',
        background: fileName ? '#dcfce7' : '#fafafa',
      }}>
        <input type="file" accept=".xlsx" style={{ display:'none' }}
          onChange={e => {
            const f = e.target.files[0]
            e.target.value = ''
            if (f) { setFileName(f.name); onChange(f) }
          }}
        />
        {fileName
          ? <><CheckCircle size={16} color='#16a34a' /><span style={{ fontSize:13, color:'#16a34a', fontWeight:500 }}>{fileName}</span></>
          : <><FileSpreadsheet size={16} color='#94a3b8' /><span style={{ fontSize:13, color:'#94a3b8' }}>Choose file...</span></>
        }
      </label>
      {summary && <div style={{ fontSize:11.5, color:'#475569', marginTop:6 }}>{summary}</div>}
    </div>
  )
}

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export default function ShopDuplicate() {
  const [exportFile, setExportFile]     = useState(null)
  const [exportInfo, setExportInfo]     = useState(null)   // { rows, sampleSku }
  const [templateFile, setTemplateFile] = useState(null)
  const [prefix, setPrefix]   = useState('')
  const [status, setStatus]   = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]     = useState('')
  const [result, setResult]   = useState(null)

  const reset = () => { setStatus(''); setError(''); setResult(null) }

  const onExport = async f => {
    reset(); setExportFile(f); setExportInfo(null)
    try {
      const rows = readSellerExport(await f.arrayBuffer())
      setExportInfo({ rows: rows.length, sampleSku: String(rows.find(r => r.sellersku)?.sellersku || '') })
    } catch (e) { setError(e.message) }
  }

  const fileBase = `cartup_shop_duplicate_${(prefix.trim().replace(/[^\w-]+/g, '') || 'output')}`

  const download = res => {
    if (res.files.length === 1) save(res.files[0].bytes, `${fileBase}.xlsx`, XLSX_TYPE)
    else save(res.zip, `${fileBase}.zip`, 'application/zip')
  }

  const handleProcess = async () => {
    if (!exportFile || !templateFile) { setError('Please select both files'); return }
    if (!prefix.trim()) { setError('Enter the new seller\'s SKU prefix'); return }
    reset(); setStatus('processing'); setProgress('Starting...')
    try {
      const res = await duplicateShop({
        exportData: await exportFile.arrayBuffer(),
        templateData: await templateFile.arrayBuffer(),
        prefix,
        onProgress: setProgress,
      })
      if (res.files.length > 1) {
        setProgress('Zipping files...')
        res.zip = await zipFiles(res.files, fileBase)
      }
      download(res)
      setResult(res); setStatus('success'); setProgress('')
    } catch (e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  const downloadWarnings = () => {
    const rows = result.report.warnings.map(w => ({ 'Export Row': w.row, 'Seller SKU': w.sku, Field: w.field, Issue: w.message }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'warnings')
    save(XLSX.write(wb, { bookType:'xlsx', type:'array' }), `${fileBase}_warnings.xlsx`, XLSX_TYPE)
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:28, boxShadow:'0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)' }
  const report = result?.report
  const grouped = report ? Object.entries(report.warnings.reduce((acc, w) => {
    const k = `${w.field} — ${w.message.replace(/"[^"]*"/, '"…"')}`
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})).sort((a, b) => b[1] - a[1]) : []

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <p style={{ color:'#718096', fontSize:13 }}>Copy every product from one seller's export into the CartUp upload template for another seller.</p>
      </div>

      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Copy size={18} color='#4f46e5' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15 }}>Shop Duplicate</div>
            <div style={{ color:'#718096', fontSize:12 }}>Old seller's product export + a blank upload template → ready-to-upload file</div>
          </div>
        </div>

        <FileInput
          label="Old seller's product export"
          hint="The admin export of the seller to copy from (ProductId, VariantName, Seller SKU, Parent Sku, Product Image1–8…)"
          onChange={onExport}
          summary={exportInfo && `${exportInfo.rows.toLocaleString()} rows${exportInfo.sampleSku ? ` · e.g. ${exportInfo.sampleSku}` : ''}`}
        />
        <FileInput
          label="Upload template (blank)"
          hint="Download a fresh one from the seller center — its Brand / Color / Size lists are used to fill the hidden ID columns"
          onChange={f => { reset(); setTemplateFile(f) }}
        />

        <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px' }}>
          New seller SKU prefix <span style={{ color:'#dc2626' }}>*</span>
        </label>
        <div style={{ fontSize:11, color:'#94a3b8', marginBottom:6 }}>Added in front of every Seller SKU and Parent SKU</div>
        <input
          value={prefix}
          onChange={e => { setPrefix(e.target.value); reset() }}
          placeholder="e.g. CCWT9323"
          style={{ width:'100%', maxWidth:280, padding:'10px 14px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box' }}
        />
        {prefix.trim() && exportInfo?.sampleSku && (
          <div style={{ fontSize:12, color:'#475569', marginTop:6, fontFamily:'monospace' }}>
            {exportInfo.sampleSku} → <b style={{ color:'#4f46e5' }}>{prefixedSku(prefix, exportInfo.sampleSku)}</b>
          </div>
        )}

        <div style={{ marginTop:18, padding:'12px 14px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, color:'#475569', lineHeight:1.7 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600, color:'#1a202c', marginBottom:4 }}>
            <Info size={13} color='#4f46e5' /> How it's filled
          </div>
          · Image URLs → file names only (as the template expects)<br/>
          · VariantName <code>Size-One Size, Color-Black</code> → Size and Color columns<br/>
          · Warranty Type ID → its name (e.g. 3 → No Warranty)<br/>
          · Duplicate Seller SKUs → first one kept · Special Price 0 → left blank<br/>
          · Word Replacements from Profile applied to names, highlights &amp; descriptions (e.g. daraz → cartup)<br/>
          · Hidden ID sheet is computed for you — no need to open in Excel first
        </div>

        {status === 'processing' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#eff6ff', borderRadius:8, color:'#2563eb', fontSize:13, marginTop:16 }}>
            <Loader size={14} style={{ animation:'spin 1s linear infinite' }} />{progress}
          </div>
        )}
        {error && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#fee2e2', borderRadius:8, color:'#dc2626', fontSize:13, marginTop:16 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button
          onClick={handleProcess}
          disabled={status === 'processing'}
          className={status === 'processing' ? '' : 'btn-primary'}
          style={{
            display:'flex', alignItems:'center', gap:8, padding:'12px 24px',
            background: status === 'processing' ? '#a5b4fc' : '#4f46e5',
            color:'#fff', border:'none', borderRadius:10,
            fontWeight:600, fontSize:14, marginTop:20,
            cursor: status === 'processing' ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'processing'
            ? <><Loader size={15} style={{ animation:'spin 1s linear infinite' }} /> Processing...</>
            : <><Download size={15} /> Process & Download</>
          }
        </button>
      </div>

      {status === 'success' && report && (
        <div style={{ ...card, marginTop:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, color:'#16a34a', fontSize:14, fontWeight:600, marginBottom:16 }}>
            <CheckCircle size={16} />
            {result.files.length > 1
              ? `Done — ${result.files.length} files downloaded as a .zip (each template holds ${report.capacity.toLocaleString()} rows; a product's variants are never split)`
              : 'Done — file downloaded'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10 }}>
            {[
              ['Rows read', report.totalRead],
              ['Duplicates removed', report.duplicates.length],
              ['Rows written', report.written],
              ['Products', report.products],
            ].map(([k, v]) => (
              <div key={k} style={{ background:'#f8fafc', borderRadius:8, padding:'10px 12px' }}>
                <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>{k}</div>
                <div style={{ fontSize:18, fontWeight:700, color:'#1a202c' }}>{v.toLocaleString()}</div>
              </div>
            ))}
          </div>

          {report.warnings.length === 0 ? (
            <div style={{ marginTop:14, fontSize:12.5, color:'#15803d' }}>No problems found — every Brand, Unit, Color and Size matched the template's lists.</div>
          ) : (
            <div style={{ marginTop:16 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600, color:'#b45309' }}>
                  <AlertTriangle size={14} /> {report.warnings.length.toLocaleString()} warnings — check these rows before uploading
                </div>
                <button onClick={downloadWarnings}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', background:'#fff', color:'#b45309', border:'1.5px solid #fde68a', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  <Download size={12} /> Warnings .xlsx
                </button>
              </div>
              <div style={{ border:'1px solid #fde68a', borderRadius:8, overflow:'hidden' }}>
                {grouped.map(([k, n]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'7px 12px', fontSize:12, background:'#fffbeb', borderBottom:'1px solid #fef3c7' }}>
                    <span style={{ color:'#92400e' }}>{k}</span>
                    <b style={{ color:'#92400e' }}>{n}</b>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:10, maxHeight:260, overflow:'auto', border:'1px solid #e2e8f0', borderRadius:8 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f8fafc', position:'sticky', top:0 }}>
                      {['Row', 'Seller SKU', 'Field', 'Issue'].map(h => (
                        <th key={h} style={{ textAlign:'left', padding:'7px 10px', color:'#64748b', fontWeight:600, borderBottom:'1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.warnings.slice(0, 300).map((w, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid #f1f5f9' }}>
                        <td style={{ padding:'6px 10px', color:'#94a3b8' }}>{w.row}</td>
                        <td style={{ padding:'6px 10px', fontFamily:'monospace' }}>{w.sku}</td>
                        <td style={{ padding:'6px 10px' }}>{w.field}</td>
                        <td style={{ padding:'6px 10px', color:'#475569' }}>{w.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.warnings.length > 300 && (
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:6 }}>Showing first 300 — download the .xlsx for all.</div>
              )}
            </div>
          )}

          <button onClick={() => download(result)}
            style={{ display:'flex', alignItems:'center', gap:6, marginTop:16, padding:'8px 14px', background:'#fff', color:'#4f46e5', border:'1.5px solid #c7d2fe', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            <Download size={13} /> Download again
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
