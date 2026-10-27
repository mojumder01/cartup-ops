import { useEffect, useMemo, useState } from 'react'
import { houseRules } from '../utils/catalog'
import { onTeamSettings } from '../utils/teamSettings'
import * as XLSX from 'xlsx'
import { duplicateShop, readSellerExport, skuCodes, parseSkuRules, planSkus, skuOptionsError, zipFiles } from '../utils/shopDuplicate'
import { loadSavedTemplate, saveTemplate, savedLabel } from '../utils/templateStore'
import { todayISO, loadSpecialEnd, saveSpecialEnd } from '../utils/dates'
import { Copy, FileSpreadsheet, CheckCircle, AlertCircle, AlertTriangle, Loader, Download, Info, Plus, X } from 'lucide-react'

// current: text shown while nothing has been picked here (e.g. a remembered file).
function FileInput({ label, hint, onChange, summary, current }) {
  const [picked, setPicked] = useState('')
  const fileName = picked || current
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
            if (f) { setPicked(f.name); onChange(f) }
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

// Small scrolling table for the result lists.
function MiniTable({ columns, rows, max = 300, height = 220 }) {
  return (
    <>
      <div style={{ maxHeight:height, overflow:'auto', border:'1px solid #e2e8f0', borderRadius:8 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'#f8fafc', position:'sticky', top:0 }}>
              {columns.map(c => <th key={c.label} style={{ textAlign:'left', padding:'7px 10px', color:'#64748b', fontWeight:600, borderBottom:'1px solid #e2e8f0' }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, max).map((r, i) => (
              <tr key={i} style={{ borderBottom:'1px solid #f1f5f9' }}>
                {columns.map(c => <td key={c.label} style={{ padding:'6px 10px', ...(c.style ? c.style(r) : {}) }}>{c.get(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > max && <div style={{ fontSize:11, color:'#94a3b8', marginTop:6 }}>Showing first {max} — all are in the Report tab.</div>}
    </>
  )
}

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const EMPTY_RULE = { from: '', to: '' }

// Adds rules, updating the new code of ones already listed.
function mergeRules(existing, incoming) {
  const out = existing.map(r => ({ ...r }))
  for (const r of incoming) {
    const hit = out.find(o => o.from.trim().toLowerCase() === r.from.trim().toLowerCase())
    if (!hit) out.push({ from: r.from, to: r.to })
    else if (r.to) hit.to = r.to
  }
  return out.length ? out : [EMPTY_RULE]
}

export default function ShopDuplicate() {
  const [, redrawTeam] = useState(0)
  useEffect(() => onTeamSettings(() => redrawTeam(n => n + 1)), [])   // the team's rules arrived or changed
  const house = houseRules()   // the team's house rules (Settings), for the texts here
  const [exportFile, setExportFile]     = useState(null)
  const [exportRows, setExportRows]     = useState(null)
  const [templateFile, setTemplateFile] = useState(null)
  const [skuMode, setSkuMode] = useState('replace')
  const [rules, setRules]     = useState([EMPTY_RULE])
  const [prefix, setPrefix]   = useState('')
  const [reportTab, setReportTab] = useState(true)
  const [spInclude, setSpInclude] = useState(true)
  const [spEnd, setSpEnd]     = useState(loadSpecialEnd)
  const [stockSame, setStockSame] = useState(false)   // one stock for every row
  const [stockValue, setStockValue] = useState('0')
  const [status, setStatus]   = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]     = useState('')
  const [result, setResult]   = useState(null)

  const [saved, setSaved]     = useState(null)

  const reset = () => { setStatus(''); setError(''); setResult(null) }
  useEffect(() => { saveSpecialEnd(spEnd) }, [spEnd])

  // The CartUp template picked last time (on this page or Daraz Upload).
  useEffect(() => {
    loadSavedTemplate().then(t => {
      if (!t) return
      setSaved(t)
      setTemplateFile(f => f || t.file)
    })
  }, [])

  const onExport = async f => {
    reset(); setExportFile(f); setExportRows(null)
    try {
      const rows = readSellerExport(await f.arrayBuffer())
      setExportRows(rows)
      // Pre-fill one replace row per seller code found in the SKUs, when the
      // SKUs follow the CODE_… pattern; rules already given a new code stay.
      const codes = skuCodes(rows).slice(0, 10)
      if (codes.reduce((n, c) => n + c.count, 0) >= rows.length * 0.8) {
        setRules(rs => mergeRules(rs.filter(r => r.from.trim() && r.to.trim()), codes.map(c => ({ from: c.code, to: '' }))))
      }
    } catch (e) { setError(e.message) }
  }

  const sku = useMemo(() => skuMode === 'replace' ? { mode: 'replace', rules } : { mode: 'prefix', prefix }, [skuMode, rules, prefix])
  const skuReady = !skuOptionsError(sku)
  const plan = useMemo(() => exportRows && planSkus(exportRows, sku), [exportRows, sku])
  const sampleSku = String(exportRows?.find(r => r.sellersku)?.sellersku || '')

  const setRule = (i, patch) => { setRules(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r)); reset() }
  const removeRule = i => { setRules(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : [EMPTY_RULE]); reset() }
  // Pasting "CCWT9196 = CCWT9197" (or several lines of them) fills the rows.
  const pasteRules = (i, e) => {
    const parsed = parseSkuRules(e.clipboardData.getData('text'))
    if (!parsed.length || (parsed.length === 1 && !parsed[0].to)) return
    e.preventDefault()
    setRules(rs => mergeRules(rs.filter((r, j) => j !== i || r.from.trim()), parsed))
    reset()
  }

  const newCode = skuMode === 'replace' ? rules.find(r => r.from.trim() && r.to.trim())?.to : prefix
  const fileBase = `cartup_shop_duplicate_${(String(newCode || '').trim().replace(/[^\w-]+/g, '') || 'output')}`

  const download = res => {
    if (res.files.length === 1) save(res.files[0].bytes, `${fileBase}.xlsx`, XLSX_TYPE)
    else save(res.zip, `${fileBase}.zip`, 'application/zip')
  }

  const handleProcess = async () => {
    if (!exportFile || !templateFile) { setError('Please select both files'); return }
    const skuError = skuOptionsError(sku)
    if (skuError) { setError(skuError); return }
    reset(); setStatus('processing'); setProgress('Starting...')
    try {
      const res = await duplicateShop({
        exportData: await exportFile.arrayBuffer(),
        templateData: await templateFile.arrayBuffer(),
        sku,
        specialPrice: { include: spInclude, start: todayISO(), end: spEnd },
        stock: { set: stockSame && stockValue !== '' ? stockValue : null },
        reportTab,
        meta: { exportName: exportFile.name, templateName: templateFile.name },
        onProgress: setProgress,
      })
      res.reportTab = reportTab
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
    const k = `${w.field} — ${w.message.replace(/"[^"]*"/g, '"…"')}`
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
          summary={exportRows && `${exportRows.length.toLocaleString()} rows${sampleSku ? ` · e.g. ${sampleSku}` : ''}`}
        />
        <FileInput
          label="Upload template (blank)"
          hint="Download a fresh one from the seller center — its Brand / Color / Size lists are used to fill the hidden ID columns"
          onChange={f => { reset(); setTemplateFile(f); saveTemplate(f) }}
          current={saved && savedLabel(saved)}
        />

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, marginBottom:6 }}>
          <label style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px' }}>
            New seller SKU <span style={{ color:'#dc2626' }}>*</span>
          </label>
          <div style={{ display:'flex', gap:3, background:'#f1f5f9', borderRadius:8, padding:3 }}>
            {[['replace', 'Replace code'], ['prefix', 'Add prefix']].map(([m, label]) => (
              <button key={m} onClick={() => { setSkuMode(m); reset() }}
                style={{
                  padding:'5px 12px', borderRadius:6, border:'none', fontSize:12, fontWeight:600, cursor:'pointer',
                  background: skuMode === m ? '#fff' : 'transparent',
                  color: skuMode === m ? '#4f46e5' : '#718096',
                  boxShadow: skuMode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {skuMode === 'replace' ? (
          <>
            <div style={{ fontSize:11, color:'#94a3b8', marginBottom:8 }}>
              Old seller code → new seller code in every Seller SKU and Parent SKU (e.g. CCWT9196_184_Anycolour → CCWT9197_184_Anycolour). You can paste lines like <code>CCWT9196 = CCWT9197</code>.
            </div>
            {rules.map((r, i) => {
              const st = plan?.rules[i]
              return (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <input value={r.from} placeholder="Old code, e.g. CCWT9196"
                    onChange={e => setRule(i, { from: e.target.value })} onPaste={e => pasteRules(i, e)}
                    style={{ width:170, flexShrink:0, padding:'8px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, fontFamily:'monospace', outline:'none', boxSizing:'border-box' }} />
                  <span style={{ color:'#94a3b8', fontWeight:700 }}>=</span>
                  <input value={r.to} placeholder="New code, e.g. CCWT9197"
                    onChange={e => setRule(i, { to: e.target.value })}
                    style={{ width:170, flexShrink:0, padding:'8px 12px', border:`1.5px solid ${r.from.trim() && !r.to.trim() ? '#fcd34d' : '#e2e8f0'}`, borderRadius:8, fontSize:13, fontFamily:'monospace', outline:'none', boxSizing:'border-box' }} />
                  <div title={st?.sample && r.to.trim() ? `${st.sample.from} → ${st.sample.to}` : undefined}
                    style={{ flex:1, minWidth:0, fontSize:11.5, color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {st && r.from.trim() && (
                      st.count === 0 ? <span style={{ color:'#b45309' }}>not found in the export</span>
                        : <>
                            <b>{st.count.toLocaleString()}</b> SKUs ·{' '}
                            {r.to.trim()
                              ? <>e.g. <b style={{ color:'#4f46e5', fontFamily:'monospace' }}>{st.sample.to}</b></>
                              : <span style={{ color:'#b45309' }}>enter the new code</span>}
                          </>
                    )}
                  </div>
                  <button onClick={() => removeRule(i)} title="Remove"
                    style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', padding:4, display:'flex' }}>
                    <X size={14} />
                  </button>
                </div>
              )
            })}
            <button onClick={() => { setRules(rs => [...rs, EMPTY_RULE]); reset() }}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', background:'none', color:'#4f46e5', border:'1px dashed #c7d2fe', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              <Plus size={12} /> Add code
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize:11, color:'#94a3b8', marginBottom:6 }}>Added in front of every Seller SKU and Parent SKU</div>
            <input
              value={prefix}
              onChange={e => { setPrefix(e.target.value); reset() }}
              placeholder="e.g. CCWT9323"
              style={{ width:'100%', maxWidth:280, padding:'10px 14px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box' }}
            />
            {skuReady && plan?.sample && (
              <div style={{ fontSize:12, color:'#475569', marginTop:6, fontFamily:'monospace' }}>
                {plan.sample.from} → <b style={{ color:'#4f46e5' }}>{plan.sample.to}</b>
              </div>
            )}
          </>
        )}

        {skuReady && plan && (plan.sellerClashes > 0 || plan.parentClashes > 0) ? (
          <div style={{ display:'flex', gap:8, marginTop:10, padding:'10px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:12, color:'#991b1b', lineHeight:1.6 }}>
            <AlertTriangle size={14} style={{ flexShrink:0, marginTop:2 }} />
            <div>
              <b>
                {[plan.sellerClashes > 0 && `${plan.sellerClashes.toLocaleString()} Seller SKUs`, plan.parentClashes > 0 && `${plan.parentClashes.toLocaleString()} Parent SKUs`].filter(Boolean).join(' and ')}
                {' '}would clash
              </b>
              {plan.example && <> — e.g. <code>{plan.example.a}</code> and <code>{plan.example.b}</code> both become <code>{plan.example.to}</code></>}.
              {' '}Give each old code its own new code{skuMode === 'replace' ? ', or use Add prefix' : ''}. The clashing rows are listed in the warnings after processing.
            </div>
          </div>
        ) : skuReady && plan && plan.unchanged === 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:10, fontSize:12, color:'#15803d' }}>
            <CheckCircle size={13} /> All {plan.total.toLocaleString()} SKUs get the new code — no clashes
          </div>
        )}
        {skuReady && plan && skuMode === 'replace' && plan.unchanged > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8, fontSize:12, color:'#b45309' }}>
            <AlertTriangle size={13} /> {plan.unchanged.toLocaleString()} of {plan.total.toLocaleString()} SKUs match no code above and keep the old seller code
          </div>
        )}

        <div style={{ marginTop:18, padding:'12px 14px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, color:'#475569', lineHeight:1.7 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600, color:'#1a202c', marginBottom:4 }}>
            <Info size={13} color='#4f46e5' /> How it's filled
          </div>
          · Seller SKU &amp; Parent SKU → old seller code replaced (CCWT9196 → CCWT9197), or a prefix added<br/>
          · Image URLs → file names only (as the template expects)<br/>
          · VariantName <code>Size-One Size, Color-Black</code> → Size and Color columns<br/>
          · Warranty Type ID → its name (e.g. 3 → No Warranty)<br/>
          · Brand, Color, Size, Warranty… matched to the template's lists — spelling / format differences fixed (EU:40 → 40 (EU), XXL → 2XL, Free Size → One Size); anything still unmatched (#N/A) is listed<br/>
          · Duplicate Seller SKUs → first one kept · Special Price 0 → left blank · a {house.discountLimit}%+ discount or one not below the price is removed<br/>
          · Stock over {house.stockCap.toLocaleString()} → {house.stockCap.toLocaleString()} · "#" in names → "{house.hashTo}" · name rules (Data &amp; Rules): {(house.nameRemove || []).slice(0, 2).map(w => `"${w}"`).join(', ')}… cut out of names, products named {(house.nameBlock || []).slice(0, 3).map(w => `"${w.replace('{n}', '99')}"`).join(', ')}… not copied · No Warranty with a period → period removed; Seller/Brand Warranty without one → No Warranty · weight starting with 0.00 (0.001–0.009) flagged<br/>
          · Word Replacements from Profile applied to names, highlights &amp; descriptions (e.g. daraz → cartup)<br/>
          · Hidden ID sheet is computed for you — no need to open in Excel first
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:14, fontSize:13, color:'#334155', flexWrap:'wrap' }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
            <input type="checkbox" checked={spInclude} onChange={e => { setSpInclude(e.target.checked); reset() }} style={{ width:15, height:15, accentColor:'#4f46e5' }} />
            Include <b>special price</b>
          </label>
          {spInclude && <>
            <span style={{ fontSize:12.5, color:'#475569' }}>from <b>{todayISO()}</b> (today) to</span>
            <input type="date" value={spEnd} min={todayISO()} onChange={e => { setSpEnd(e.target.value); reset() }}
              style={{ padding:'5px 8px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12.5 }} />
          </>}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, fontSize:13, color:'#334155', flexWrap:'wrap' }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
            <input type="checkbox" checked={stockSame} onChange={e => { setStockSame(e.target.checked); reset() }} style={{ width:15, height:15, accentColor:'#4f46e5' }} />
            Same <b>stock</b> for every row
          </label>
          {stockSame ? <>
            <input type="number" min={0} max={99999} value={stockValue} onChange={e => { setStockValue(e.target.value); reset() }} aria-label="Stock for every row"
              style={{ width:90, padding:'5px 8px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12.5 }} />
            <span style={{ fontSize:12, color:'#94a3b8' }}>e.g. 0 when the seller wants to upload with no stock — listed under Changed values</span>
          </> : <span style={{ fontSize:12, color:'#94a3b8' }}>off: stock as in the export (never above {house.stockCap.toLocaleString()})</span>}
        </div>

        <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, fontSize:13, color:'#334155', cursor:'pointer', width:'fit-content' }}>
          <input type="checkbox" checked={reportTab} onChange={e => { setReportTab(e.target.checked); reset() }} style={{ width:15, height:15, accentColor:'#4f46e5' }} />
          Add a <b>Report</b> tab to the file — summary, #N/A cells, auto-matched values, removed duplicates and warnings
        </label>

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
          <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:8, color:'#16a34a', fontSize:14, fontWeight:600, marginBottom:16 }}>
            <CheckCircle size={16} />
            {result.files.length > 1
              ? `Done — ${result.files.length} files downloaded as a .zip (each template holds ${report.capacity.toLocaleString()} rows; a product's variants are never split)`
              : 'Done — file downloaded'}
            {result.reportTab && <span style={{ color:'#64748b', fontWeight:500 }}>· details in its Report tab</span>}
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

          {report.notes.length > 0 && (
            <div style={{ marginTop:14, padding:'10px 12px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e', lineHeight:1.6 }}>
              {report.notes.map(n => <div key={n} style={{ display:'flex', gap:6 }}><Info size={13} style={{ flexShrink:0, marginTop:2 }} />{n}</div>)}
            </div>
          )}

          {report.hiddenErrors.length > 0 && (
            <div style={{ marginTop:16 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600, color:'#b91c1c', marginBottom:8 }}>
                <AlertCircle size={14} /> {report.hiddenErrors.length.toLocaleString()} cells in payload_hidden still show #N/A — the platform will reject these rows. Pick the value from the dropdown in the file{result.reportTab ? ' (also listed in its Report tab)' : ''}.
              </div>
              <MiniTable rows={report.hiddenErrors} columns={[
                ...(result.files.length > 1 ? [{ label:'File', get: e => `Part ${e.file}` }] : []),
                { label:'File row', get: e => e.fileRow, style: () => ({ color:'#94a3b8' }) },
                { label:'Seller SKU', get: e => e.sku, style: () => ({ fontFamily:'monospace' }) },
                { label:'Column', get: e => e.column },
                { label:'Value', get: e => e.value || '(blank)', style: () => ({ color:'#b91c1c', fontWeight:600 }) },
                { label:'Error', get: e => e.error, style: () => ({ color:'#b91c1c' }) },
              ]} />
            </div>
          )}

          {report.fixes.length > 0 && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#334155', marginBottom:8 }}>
                {report.fixes.length.toLocaleString()} values changed automatically (list spelling, special prices, stock option / cap, "#" and claim words in names, warranty) — check any that look wrong
              </div>
              <MiniTable rows={report.fixes} columns={[
                { label:'Row', get: f => f.row, style: () => ({ color:'#94a3b8' }) },
                { label:'Seller SKU', get: f => f.sku, style: () => ({ fontFamily:'monospace' }) },
                { label:'Column', get: f => f.field },
                { label:'Export value → written as', get: f => <>{f.from} → <b style={{ color:'#4f46e5' }}>{f.to}</b></> },
                { label:'Why', get: f => f.how, style: () => ({ color:'#64748b' }) },
              ]} />
            </div>
          )}

          {report.blocked?.length > 0 && (
            <div data-name-blocked style={{ marginTop:16 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#b45309', marginBottom:8 }}>
                {report.blocked.length.toLocaleString()} rows not copied — the name has words the team doesn't upload (Data &amp; Rules → name rules: {[...new Set(report.blocked.map(b => b.phrase))].join(', ')})
              </div>
              <MiniTable rows={report.blocked} columns={[
                { label:'Row', get: b => b.row, style: () => ({ color:'#94a3b8' }) },
                { label:'Seller SKU', get: b => b.sku, style: () => ({ fontFamily:'monospace' }) },
                { label:'Product', get: b => b.name },
                { label:'Why', get: b => b.why, style: () => ({ color:'#b45309' }) },
              ]} />
            </div>
          )}

          {report.duplicates.length > 0 && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#334155', marginBottom:8 }}>
                {report.duplicates.length.toLocaleString()} duplicate rows removed — the first row of each Seller SKU was kept
              </div>
              <MiniTable rows={report.duplicates} columns={[
                { label:'Row', get: d => d.row, style: () => ({ color:'#94a3b8' }) },
                { label:'Seller SKU', get: d => d.sku, style: () => ({ fontFamily:'monospace' }) },
                { label:'Kept row', get: d => d.keptRow, style: () => ({ color:'#94a3b8' }) },
                { label:'Difference from kept row', get: d => d.difference, style: d => ({ color: d.difference === 'Same as kept row' ? '#94a3b8' : '#b45309' }) },
              ]} />
            </div>
          )}

          {report.warnings.length === 0 ? (report.hiddenErrors.length === 0 &&
            <div style={{ marginTop:14, fontSize:12.5, color:'#15803d' }}>No problems found — every Brand, Unit, Color and Size matched the template's lists, and no hidden cell shows #N/A.</div>
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
