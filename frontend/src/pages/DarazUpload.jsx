import { useEffect, useMemo, useState } from 'react'
import { getActiveApiKey as getApiKey } from '../utils/gemini'
import { getProvider } from '../utils/aiProvider'
import { loadKeys, PROVIDER_LABEL } from '../utils/aiPool'
import {
  processDarazFiles, buildOutput, buildDarazWorkbook, templateLists, rematch, rowKey,
  readTableFile, guessImageColumns, makeImageKeyMap, OUTPUT_COLS,
} from '../utils/processor'
import { loadMemory, rememberDecisions, forgetMemory } from '../utils/variantReview'
import { loadSavedTemplate, saveTemplate, savedLabel } from '../utils/templateStore'
import { todayISO, loadSpecialEnd, saveSpecialEnd } from '../utils/dates'
import VariantReview from '../components/VariantReview'
import SheetEditor from '../components/SheetEditor'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, AlertTriangle, Loader, Download, Zap, ListChecks, Layers, Table2, RefreshCw, Settings2 } from 'lucide-react'

// current: text shown while nothing has been picked here (e.g. a remembered file).
function FileInput({ label, required, onChange, current, hint }) {
  const [picked, setPicked] = useState('')
  const fileName = picked || current
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.4px' }}>
        {label} {required && <span style={{ color:'#dc2626' }}>*</span>}
      </label>
      {hint && <div style={{ fontSize:11, color:'#94a3b8', marginTop:-2, marginBottom:6 }}>{hint}</div>}
      <label className="file-drop" style={{
        display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        border:`1.5px dashed ${fileName ? '#16a34a' : '#e2e8f0'}`,
        borderRadius:8, cursor:'pointer',
        background: fileName ? '#dcfce7' : '#fafafa',
      }}>
        <input type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }}
          onChange={e => {
            const f = e.target.files[0]
            e.target.value = ''   // allow re-selecting the same file name
            if(f){ setPicked(f.name); onChange(f) }
          }}
        />
        {fileName
          ? <><CheckCircle size={16} color='#16a34a' /><span style={{ fontSize:13, color:'#16a34a', fontWeight:500 }}>{fileName}</span></>
          : <><FileSpreadsheet size={16} color='#94a3b8' /><span style={{ fontSize:13, color:'#94a3b8' }}>Choose file...</span></>
        }
      </label>
    </div>
  )
}

export default function DarazUpload() {
  const apiKey = getApiKey()
  const provider = getProvider()
  const keyCount = loadKeys()[provider].length
  const [files, setFiles]     = useState({})
  const [status, setStatus]   = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(null)
  const [result, setResult]   = useState(null)       // processed run, kept for review, edits + download
  const [decisions, setDecisions] = useState({})
  const [memory, setMemory]   = useState(loadMemory)
  const [edits, setEdits]     = useState({})
  const [reviewing, setReviewing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [rechecking, setRechecking] = useState('')

  // Run options — rows before processing; special price and image keys apply at download (no re-run).
  const [activeOnly, setActiveOnly] = useState(false)
  const [spInclude, setSpInclude] = useState(true)
  const [spEnd, setSpEnd]         = useState(loadSpecialEnd)
  const [keySheets, setKeySheets] = useState(null)   // image key file: [{ name, columns, rows }]
  const [keyPick, setKeyPick]     = useState({ sheet: 0, link: '', key: '' })

  const imageKeys = useMemo(() => {
    const sh = keySheets?.[keyPick.sheet]
    return sh && keyPick.link && keyPick.key ? makeImageKeyMap(sh.rows, keyPick.link, keyPick.key) : null
  }, [keySheets, keyPick])
  const options = useMemo(() => ({ specialPrice: { include: spInclude, start: todayISO(), end: spEnd }, imageKeys, edits }), [spInclude, spEnd, imageKeys, edits])

  // Live output for the current decisions, options and edits.
  const output = useMemo(() => result && buildOutput(result, decisions, memory, options), [result, decisions, memory, options])
  const stats = output?.stats

  // The CartUp template picked last time (on this page or Shop Duplicate).
  useEffect(() => {
    loadSavedTemplate().then(t => {
      if (!t) return
      setSaved(t)
      setFiles(p => p.template ? p : { ...p, template: t.file })
    })
  }, [])
  useEffect(() => { saveSpecialEnd(spEnd) }, [spEnd])

  const pick = key => f => {
    setFiles(p => ({ ...p, [key]: f })); setStatus(''); setError(''); setResult(null)
    if (key === 'template') saveTemplate(f)
  }
  const pickKeyFile = async f => {
    try {
      const sheets = await readTableFile(f)
      if (!sheets.length) throw new Error('The image key file has no rows')
      setKeySheets(sheets)
      setKeyPick({ sheet: 0, ...guessImageColumns(sheets[0]) })
    } catch (e) { setError(`Image key file: ${e.message}`) }
  }

  const handleProcess = async () => {
    if (!files.price || !files.basic || !files.weight || !files.skuimg) {
      setError('Please select all required files'); return
    }
    setError(''); setStatus('processing'); setProgress('Starting...'); setResult(null); setDecisions({}); setEdits({})
    try {
      const res = await processDarazFiles(files, apiKey, msg => setProgress(msg), { activeOnly })
      setResult(res); setStatus('success'); setProgress('')
      // Values still undecided (or variants left identical) → review first; otherwise download now.
      const out = buildOutput(res, {}, memory, options)
      if (out.stats.open || out.stats.dupes) setReviewing(true)
      else download(res, {}, {})
    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  // A newer template (values added to CartUp's lists) — checked again without re-running.
  const recheck = async f => {
    setRechecking(f.name); setError('')
    try {
      const lists = await templateLists(f)
      setResult(r => rematch(r, lists))
      saveTemplate(f)
      setSaved({ file: f, savedAt: Date.now() })
    } catch (e) { setError(`Template: ${e.message}`) }
    setRechecking('')
  }

  function download(res = result, dec = decisions, ed = edits) {
    const { bytes } = buildDarazWorkbook(res, dec, memory, { ...options, edits: ed })
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'cartup_daraz_output.xlsx'; a.click()
    URL.revokeObjectURL(url)
    setMemory(rememberDecisions(dec))
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:28, boxShadow:'0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)' }
  const seg = (on, label, click) => (
    <button key={label} onClick={click} style={{ padding:'5px 12px', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background: on ? '#fff' : 'transparent', color: on ? '#4f46e5' : '#64748b', boxShadow: on ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{label}</button>
  )
  const lbl = { fontSize:12, fontWeight:600, color:'#475569', minWidth:110 }
  const sel = { padding:'5px 8px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12, background:'#fff', maxWidth:220 }
  const btn = (primary) => ({ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background: primary ? '#4f46e5' : '#fff', color: primary ? '#fff' : '#4f46e5', border: primary ? 'none' : '1.5px solid #c7d2fe', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' })

  const rows = output?.rows.length || 0
  const needs = output?.attention.size || 0
  const autoPct = rows ? Math.round(((rows - needs) / rows) * 100) : 0
  const valuePct = stats?.checked ? Math.round(((stats.checked - stats.open) / stats.checked) * 100) : 100
  const ruleLine = output && [
    output.rules.discountRemoved && `${output.rules.discountRemoved} special prices removed (75%+ discount)`,
    output.rules.stockCapped && `${output.rules.stockCapped} stocks capped at 99,999`,
    output.rules.namesHash && `${output.rules.namesHash} names: "#" → "-"`,
    output.rules.lowWeight && `${output.rules.lowWeight} weights below 0.01 kg flagged`,
    imageKeys && `${output.rules.imageKeyed} images → keys${output.rules.imageMissing ? ` (${output.rules.imageMissing} links without a key)` : ''}`,
    output.rules.edited && `${output.rules.edited} cells edited by hand`,
  ].filter(Boolean)

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <p style={{ color:'#718096', fontSize:13 }}>Upload 4–5 Daraz export files → CartUp template format with AI assistance.</p>
      </div>

      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Upload size={18} color='#4f46e5' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15 }}>Daraz Export Files</div>
            <div style={{ color:'#718096', fontSize:12 }}>Price, Basic, Weight, SKU Image (+ optional Attribute, CartUp template, image keys)</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
          <FileInput label="Price / Stock file" required onChange={pick('price')} />
          <FileInput label="Basic file"          required onChange={pick('basic')} />
          <FileInput label="Weight file"         required onChange={pick('weight')} />
          <FileInput label="SKU Image file"      required onChange={pick('skuimg')} />
          <FileInput label="Attribute file (optional)" onChange={pick('attr')}
            hint="Brands come from here — without it every product is No Brand" />
          <FileInput label="CartUp upload template (recommended)" onChange={pick('template')}
            current={saved && savedLabel(saved)}
            hint="Color, Size, Brand, Warranty… are checked against its dropdown lists — remembered for next time" />
        </div>

        {/* Run options */}
        <div style={{ marginTop:8, padding:'14px 16px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, fontWeight:700, color:'#1a202c' }}><Settings2 size={14} color='#4f46e5' /> Options</div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={lbl}>Rows</span>
            <div style={{ display:'flex', gap:3, background:'#eef2f7', borderRadius:8, padding:3 }}>
              {seg(!activeOnly, 'All rows', () => { setActiveOnly(false); setResult(null); setStatus('') })}
              {seg(activeOnly, 'Active only', () => { setActiveOnly(true); setResult(null); setStatus('') })}
            </div>
            <span style={{ fontSize:11.5, color:'#94a3b8' }}>by the price file's status column</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={lbl}>Special price</span>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, cursor:'pointer' }}>
              <input type="checkbox" checked={spInclude} onChange={e => setSpInclude(e.target.checked)} style={{ accentColor:'#4f46e5' }} /> Include
            </label>
            {spInclude && <>
              <span style={{ fontSize:12.5, color:'#475569' }}>from <b>{todayISO()}</b> (the day the file is made) to</span>
              <input type="date" value={spEnd} min={todayISO()} onChange={e => setSpEnd(e.target.value)} style={sel} />
              <span style={{ fontSize:11.5, color:'#94a3b8' }}>a discount of 75% or more is removed</span>
            </>}
          </div>
          <div style={{ display:'flex', alignItems:'flex-start', gap:10, flexWrap:'wrap' }}>
            <span style={{ ...lbl, paddingTop:8 }}>Image keys</span>
            <div style={{ flex:1, minWidth:260 }}>
              <FileInput label="Image key file (optional — when CartUp image keys are ready)" onChange={pickKeyFile}
                hint="Daraz image links are replaced by these keys; add it now or after processing" />
              {keySheets && (
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', fontSize:12, marginTop:-4 }}>
                  {keySheets.length > 1 && <>
                    <span>Sheet</span>
                    <select value={keyPick.sheet} onChange={e => { const i = +e.target.value; setKeyPick({ sheet: i, ...guessImageColumns(keySheets[i]) }) }} style={sel}>
                      {keySheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                    </select>
                  </>}
                  <span>Daraz link column</span>
                  <select value={keyPick.link} onChange={e => setKeyPick(k => ({ ...k, link: e.target.value }))} style={sel}>
                    {keySheets[keyPick.sheet].columns.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <span>Image key column</span>
                  <select value={keyPick.key} onChange={e => setKeyPick(k => ({ ...k, key: e.target.value }))} style={sel}>
                    {keySheets[keyPick.sheet].columns.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <span style={{ color: imageKeys?.size ? '#15803d' : '#b45309' }}>{imageKeys?.size ? `${imageKeys.size.toLocaleString()} links paired` : 'no pairs — check the columns'}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {apiKey ? (
          <div style={{ background:'#eef2ff', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#4338ca', marginTop:12 }}>
            <Zap size={13} style={{ verticalAlign:'middle', marginRight:6 }} />
            AI enabled — name fix, category matching &amp; content via {PROVIDER_LABEL[provider]} ({keyCount} key{keyCount > 1 ? 's' : ''}, used in turn)
          </div>
        ) : (
          <div style={{ background:'#fef3c7', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#92400e', marginTop:12 }}>
            No {PROVIDER_LABEL[provider]} API key — AI features disabled. Add keys in Profile.
          </div>
        )}

        {status === 'processing' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#eff6ff', borderRadius:8, color:'#2563eb', fontSize:13, marginTop:16 }}>
            <Loader size={14} style={{ animation:'spin 1s linear infinite' }} />{progress}
          </div>
        )}
        {status === 'success' && output && (
          <div style={{ marginTop:16, border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 16px', background:'#dcfce7', color:'#166534', fontSize:13, fontWeight:600 }}>
              <CheckCircle size={14} /> Processed — {rows.toLocaleString()} rows
              <span style={{ fontWeight:500 }}>
                {result.invalidRows.length ? ` · ${result.invalidRows.length.toLocaleString()} in "invalid" (missing name, price or image)` : ''}
                {result.duplicateSkus.length ? ` · ${result.duplicateSkus.length} repeated Seller SKU rows removed` : ''}
                {result.skipped ? ` · ${result.skipped.toLocaleString()} inactive rows left out` : ''}
              </span>
            </div>

            <div style={{ padding:'14px 16px', fontSize:12.5, color:'#334155', lineHeight:1.7 }}>
              {/* How much is automatic */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10, flexWrap:'wrap' }}>
                <div style={{ fontSize:22, fontWeight:800, color: autoPct >= 90 ? '#15803d' : '#b45309' }}>{autoPct}%</div>
                <div style={{ flex:1, minWidth:220 }}>
                  <div style={{ fontWeight:600, color:'#1a202c' }}>of rows are ready without you · {needs.toLocaleString()} row{needs === 1 ? '' : 's'} need a look</div>
                  <div style={{ height:7, background:'#fee2e2', borderRadius:4, overflow:'hidden', marginTop:4 }}>
                    <div style={{ width:`${autoPct}%`, height:'100%', background:'#22c55e' }} />
                  </div>
                </div>
              </div>

              {result.template ? <>
                <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600, color:'#1a202c' }}>
                  <ListChecks size={14} color='#4f46e5' /> Dropdown values: {stats.checked.toLocaleString()} checked · {valuePct}% settled automatically
                </div>
                <div>· {stats.auto.toLocaleString()} matched automatically (spelling, EU:40 → 40 (EU), XXL → 2XL, Multicolor-1/-2 to keep variants apart, warranty rules)</div>
                {stats.remembered > 0 && <div>· {stats.remembered.toLocaleString()} from picks remembered from earlier runs</div>}
                {stats.picked > 0 && <div>· {stats.picked.toLocaleString()} picked by you</div>}
                {stats.kept > 0 && <div>· {stats.kept.toLocaleString()} kept as new values for CartUp's lists ("new values" sheet)</div>}
                {stats.open > 0
                  ? <div style={{ color:'#b91c1c', display:'flex', alignItems:'center', gap:6 }}><AlertTriangle size={13} /> {stats.open.toLocaleString()} values ({stats.openValues.toLocaleString()} different) in {stats.openParents.toLocaleString()} products not on the lists yet — they'd show #N/A in payload_hidden</div>
                  : <div style={{ color:'#15803d' }}>· Every value is matched or decided — no #N/A expected</div>}
                {stats.dupes > 0 && <div style={{ color:'#b45309' }}>· {stats.dupes.toLocaleString()} SKUs have the same variant values as a sibling — change them in the review</div>}
              </> : (
                <div style={{ color:'#92400e' }}>Values were not checked against CartUp's dropdown lists — add the CartUp template (below or above) to catch #N/A before uploading.</div>
              )}
              {ruleLine.length > 0 && <div style={{ marginTop:4, color:'#475569' }}>· {ruleLine.join(' · ')}</div>}

              <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                {result.template && (
                  <button onClick={() => setReviewing(true)} style={btn(true)}>
                    <Layers size={14} /> Review product by product{stats.open ? ` (${stats.open} open)` : ''}
                  </button>
                )}
                <button onClick={() => setSheetOpen(true)} style={btn(!result.template)}>
                  <Table2 size={14} /> View &amp; edit sheet{needs ? ` (${needs} rows to check)` : ''}
                </button>
                <button onClick={() => download()} style={btn(false)}><Download size={14} /> Download file</button>
              </div>

              <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:14, paddingTop:12, borderTop:'1px solid #f1f5f9', flexWrap:'wrap' }}>
                <RefreshCw size={14} color='#4f46e5' />
                <span style={{ fontSize:12.5 }}>Values added to CartUp's lists? Check again with a newer template — no re-run, your picks and edits stay.</span>
                <label style={{ ...btn(false), padding:'6px 12px', fontSize:12 }}>
                  {rechecking ? <><Loader size={12} style={{ animation:'spin 1s linear infinite' }} /> {rechecking}</> : 'Choose template…'}
                  <input type="file" accept=".xlsx" style={{ display:'none' }} onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) recheck(f) }} />
                </label>
              </div>
              <div style={{ fontSize:11.5, color:'#64748b', marginTop:8 }}>
                The file has <b>changes</b> (every change, one row per Seller SKU), <b>to check</b> (flagged, not changed) and <b>new values</b> (not on CartUp's lists) sheets.
              </div>
            </div>
          </div>
        )}
        {reviewing && result && (
          <VariantReview result={result} decisions={decisions} setDecisions={setDecisions} memory={memory}
            onForgetMemory={() => setMemory(forgetMemory())}
            onDownload={() => download()}
            onClose={() => setReviewing(false)} />
        )}
        {sheetOpen && output && (
          <SheetEditor output={output} items={result.items} columns={OUTPUT_COLS.filter(c => c !== 'Report')} lists={result.lists}
            keyOf={i => rowKey(result.items[i], i)} edits={edits} setEdits={setEdits}
            onDownload={() => download()} onClose={() => setSheetOpen(false)} />
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

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
