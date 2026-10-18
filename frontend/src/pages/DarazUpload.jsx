import { useEffect, useMemo, useState } from 'react'
import { getActiveApiKey as getApiKey } from '../utils/gemini'
import { poolSummary, onAiChange, sessionStats, resetText, maskKey } from '../utils/aiPool'
import {
  processDarazFiles, buildOutput, buildDarazWorkbook, templateLists, rematch, rowKey,
  readTableFile, guessImageColumns, makeImageKeyMap, OUTPUT_COLS,
} from '../utils/processor'
import { loadMemory, rememberDecisions, forgetMemory, valueGroups } from '../utils/variantReview'
import { sheetIssues, buildChecklist } from '../utils/checks'
import { loadSavedTemplate, saveTemplate, savedLabel } from '../utils/templateStore'
import { todayISO, loadSpecialEnd, saveSpecialEnd } from '../utils/dates'
import VariantReview from '../components/VariantReview'
import SheetEditor from '../components/SheetEditor'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, AlertTriangle, Loader, Download, Zap, ListChecks, Layers, Table2, RefreshCw, Settings2, Info, ChevronRight, ClipboardCheck } from 'lucide-react'

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

const SHEET_COLS = OUTPUT_COLS.filter(c => c !== 'Report')
const BATCH = 5   // products per AI request (processor.js)

export default function DarazUpload() {
  const [, redraw] = useState(0)
  useEffect(() => onAiChange(() => redraw(n => n + 1)), [])
  const apiKey = getApiKey()
  const pool = poolSummary()
  const [files, setFiles]     = useState({})
  const [status, setStatus]   = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(null)
  const [result, setResult]   = useState(null)       // processed run, kept for review, edits + download
  const [decisions, setDecisions] = useState({})
  const [memory, setMemory]   = useState(loadMemory)
  const [edits, setEdits]     = useState({})
  const [reviewing, setReviewing] = useState(null)   // where the review window opens: { view, state, col } | null
  const [sheetOpen, setSheetOpen] = useState(null)   // the sheet view's filter | null
  const [rechecking, setRechecking] = useState('')

  // Run options — rows before processing; special price and image keys apply at download (no re-run).
  const [activeOnly, setActiveOnly] = useState(false)
  const [spInclude, setSpInclude] = useState(true)
  const [spEnd, setSpEnd]         = useState(loadSpecialEnd)
  const [stockMode, setStockMode] = useState('file')   // 'file' | 'set' — one number for every row
  const [stockValue, setStockValue] = useState('0')
  const [aiRun, setAiRun]         = useState(null)     // AI calls of the latest run: { start, end }
  const [keySheets, setKeySheets] = useState(null)   // image key file: [{ name, columns, rows }]
  const [keyPick, setKeyPick]     = useState({ sheet: 0, link: '', key: '' })

  const imageKeys = useMemo(() => {
    const sh = keySheets?.[keyPick.sheet]
    return sh && keyPick.link && keyPick.key ? makeImageKeyMap(sh.rows, keyPick.link, keyPick.key) : null
  }, [keySheets, keyPick])
  const stockSet = stockMode === 'set' && stockValue !== '' ? stockValue : null
  const options = useMemo(() => ({ specialPrice: { include: spInclude, start: todayISO(), end: spEnd }, stock: { set: stockSet }, imageKeys, edits }), [spInclude, spEnd, stockSet, imageKeys, edits])

  // Live output for the current decisions, options and edits.
  const output = useMemo(() => result && buildOutput(result, decisions, memory, options), [result, decisions, memory, options])
  const stats = output?.stats
  // What still needs a look, for the check list (same counts as the review window and sheet view).
  const values = useMemo(() => result && result.template ? valueGroups(result, decisions, memory) : [], [result, decisions, memory])
  const issues = useMemo(() => output ? sheetIssues(output, SHEET_COLS, result.lists) : new Map(), [output])
  const checks = useMemo(() => output ? buildChecklist({ result, output, issues, values, imageKeys }) : [], [output, issues, values])
  const toFix = checks.filter(c => c.level === 'fix' && c.count).length
  const toCheck = checks.filter(c => c.level === 'check' && c.count).length
  const openCheck = c => c.open?.review ? setReviewing(c.open.review) : c.open?.sheet && setSheetOpen(c.open.sheet)

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
    setAiRun({ start: sessionStats(), end: null })
    try {
      const res = await processDarazFiles(files, apiKey, msg => setProgress(msg), { activeOnly })
      setAiRun(r => r && { ...r, end: sessionStats() })
      setResult(res); setStatus('success'); setProgress('')
      // Values still undecided (or variants left identical) → review first; otherwise download now.
      const out = buildOutput(res, {}, memory, options)
      if (out.stats.open || out.stats.dupes) setReviewing(out.stats.open ? { view: 'values', state: 'open', col: 'all' } : { view: 'products', state: 'dupes', col: 'all' })
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

  // AI calls since the run started (live while it runs).
  const aiNow = aiRun && (aiRun.end || sessionStats())
  const aiUse = aiNow && { calls: aiNow.calls - aiRun.start.calls, failed: aiNow.failed - aiRun.start.failed, tokens: aiNow.tokens - aiRun.start.tokens,
    key: aiNow.key, keyNo: pool.keys.find(k => k.key === aiNow.key)?.n, model: pool.models.find(m => m.id === aiNow.model)?.label || aiNow.model }

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
    output.rules.stockSet && `${output.rules.stockSet} stocks set to ${stockSet}`,
    output.rules.stockCapped && `${output.rules.stockCapped} stocks capped at 99,999`,
    output.rules.namesHash && `${output.rules.namesHash} names: "#" → "-"`,
    output.rules.lowWeight && `${output.rules.lowWeight} weights starting with 0.00 flagged`,
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
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={lbl}>Stock</span>
            <div style={{ display:'flex', gap:3, background:'#eef2f7', borderRadius:8, padding:3 }}>
              {seg(stockMode === 'file', 'As in file', () => setStockMode('file'))}
              {seg(stockMode === 'set', 'Same for every row', () => setStockMode('set'))}
            </div>
            {stockMode === 'set' ? <>
              <input type="number" min={0} max={99999} value={stockValue} onChange={e => setStockValue(e.target.value)} aria-label="Stock for every row" style={{ ...sel, width:90 }} />
              <span style={{ fontSize:11.5, color:'#94a3b8' }}>e.g. 0 when the seller wants to upload with no stock — every change is logged</span>
            </> : <span style={{ fontSize:11.5, color:'#94a3b8' }}>from the price file, never above 99,999</span>}
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
          <div style={{ background: pool.left ? '#eef2ff' : '#fef3c7', borderRadius:8, padding:'10px 14px', fontSize:12, color: pool.left ? '#4338ca' : '#92400e', marginTop:12, lineHeight:1.6 }}>
            <Zap size={13} style={{ verticalAlign:'middle', marginRight:6 }} />
            AI on — names, highlights, description &amp; categories with Gemini ({pool.models[0]?.label || 'no model'}) · {pool.ticked} key{pool.ticked === 1 ? '' : 's'} ticked
            {' · '}<b>{pool.left.toLocaleString()}</b> requests left today (≈ {(pool.left * BATCH).toLocaleString()} products) · ≈ {pool.perMinute}/min · resets {resetText()}
            {!pool.left && <> — today's limit is used: names get the spelling fix only. Add or tick keys/models in Profile, or wait for the reset.</>}
          </div>
        ) : (
          <div style={{ background:'#fef3c7', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#92400e', marginTop:12 }}>
            No Gemini key ticked — AI is off (names get the spelling fix only). Add or tick keys in Profile.
          </div>
        )}

        {status === 'processing' && (
          <div style={{ padding:'12px 16px', background:'#eff6ff', borderRadius:8, color:'#2563eb', fontSize:13, marginTop:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}><Loader size={14} style={{ animation:'spin 1s linear infinite' }} />{progress}</div>
            {apiKey && aiUse && (
              <div data-ai-live style={{ fontSize:11.5, color:'#475569', marginTop:6, fontVariantNumeric:'tabular-nums' }}>
                AI · {aiUse.calls.toLocaleString()} request{aiUse.calls === 1 ? '' : 's'}{aiUse.failed ? ` (${aiUse.failed} failed)` : ''} · {aiUse.tokens.toLocaleString()} tokens
                {aiUse.key && <> · now Key {aiUse.keyNo || '?'} ({maskKey(aiUse.key)}) on {aiUse.model}</>} · {pool.left.toLocaleString()} left today
              </div>
            )}
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
              {/* How much is automatic, and is it ready */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, flexWrap:'wrap' }}>
                <div style={{ fontSize:22, fontWeight:800, color: autoPct >= 90 ? '#15803d' : '#b45309' }}>{autoPct}%</div>
                <div style={{ flex:1, minWidth:220 }}>
                  <div style={{ fontWeight:600, color:'#1a202c' }}>of rows are ready without you · {needs.toLocaleString()} row{needs === 1 ? '' : 's'} need a look</div>
                  <div style={{ height:7, background:'#fee2e2', borderRadius:4, overflow:'hidden', marginTop:4 }}>
                    <div style={{ width:`${autoPct}%`, height:'100%', background:'#22c55e' }} />
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:20, fontWeight:700, fontSize:12.5,
                  background: toFix ? '#fee2e2' : toCheck ? '#fef3c7' : '#dcfce7', color: toFix ? '#b91c1c' : toCheck ? '#92400e' : '#15803d' }}>
                  {toFix ? <><AlertTriangle size={14} /> {toFix} thing{toFix > 1 ? 's' : ''} to fix{toCheck ? ` · ${toCheck} to check` : ''}</>
                    : toCheck ? <><ClipboardCheck size={14} /> Ready — {toCheck} thing{toCheck > 1 ? 's' : ''} worth a look</>
                    : <><CheckCircle size={14} /> Ready to upload</>}
                </div>
              </div>

              {/* Check list: each check, how many, why, and one click to the right view */}
              <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden', marginBottom:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0', fontWeight:700, color:'#1a202c' }}>
                  <ListChecks size={14} color='#4f46e5' /> Before you upload — check list
                  <span style={{ fontWeight:500, color:'#64748b', fontSize:11.5 }}>red = fix · amber = worth a look · green = done</span>
                </div>
                {checks.map(c => {
                  const done = !c.count
                  const color = c.level === 'info' ? '#64748b' : done ? '#16a34a' : c.level === 'fix' ? '#dc2626' : '#d97706'
                  const Icon = c.level === 'info' ? Info : done ? CheckCircle : AlertTriangle
                  return (
                    <div key={c.id} data-check={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding: done ? '5px 12px' : '8px 12px', borderBottom:'1px solid #f1f5f9', background: done ? '#fff' : c.level === 'fix' ? '#fffafa' : c.level === 'check' ? '#fffdf5' : '#fff' }}>
                      <Icon size={15} color={color} style={{ flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight: done ? 500 : 600, color: done ? '#64748b' : '#1a202c', lineHeight:1.4 }}>{c.title}</div>
                        {!done && <div style={{ fontSize:11.5, color:'#64748b', lineHeight:1.4 }}>{c.why}</div>}
                      </div>
                      <div style={{ textAlign:'right', minWidth:90, lineHeight:1.3 }}>
                        <div style={{ fontWeight:700, color }}>{done ? '0' : `${c.count.toLocaleString()} ${c.unit}${c.count > 1 ? 's' : ''}`}</div>
                        {c.extra && <div style={{ fontSize:11, color:'#94a3b8' }}>{c.extra}</div>}
                      </div>
                      <div style={{ width:112, display:'flex', justifyContent:'flex-end' }}>
                        {c.open && (!done || c.id === 'fuzzy' && c.extra) && (
                          <button onClick={() => openCheck(c)} style={{ ...btn(!done && c.level === 'fix'), padding:'5px 10px', fontSize:12 }}>
                            {c.open.review ? ({ changed: 'Glance', kept: 'See' }[c.open.review.state] || 'Match') : 'Open'} <ChevronRight size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {!result.template && (
                  <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'#fffafa' }}>
                    <AlertTriangle size={15} color='#dc2626' />
                    <div style={{ flex:1, color:'#92400e' }}>Values were not checked against CartUp's dropdown lists — add the CartUp template (below) to catch #N/A before uploading.</div>
                  </div>
                )}
              </div>

              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {result.template && (
                  <button onClick={() => setReviewing({ view: stats.open ? 'values' : 'products', state: stats.open ? 'open' : 'attention', col: 'all' })} style={btn(true)}>
                    <Layers size={14} /> Check &amp; match values{stats.open ? ` (${stats.openValues} open)` : ''}
                  </button>
                )}
                <button onClick={() => setSheetOpen('problems')} style={btn(!result.template)}>
                  <Table2 size={14} /> View &amp; edit sheet{needs ? ` (${needs} rows to check)` : ''}
                </button>
                <button onClick={() => download()} style={btn(false)}><Download size={14} /> Download file</button>
              </div>

              <details style={{ marginTop:12 }}>
                <summary style={{ cursor:'pointer', fontWeight:600, color:'#4f46e5', fontSize:12.5 }}>What was done automatically</summary>
                <div style={{ marginTop:6 }}>
                  {result.template ? <>
                    <div>· Dropdown values: {stats.checked.toLocaleString()} checked · {valuePct}% settled automatically</div>
                    <div>· {stats.auto.toLocaleString()} matched automatically (spelling, EU:40 → 40 (EU), XXL → 2XL, Multicolor-1/-2 to keep variants apart, warranty rules)</div>
                    {stats.remembered > 0 && <div>· {stats.remembered.toLocaleString()} from picks remembered from earlier runs</div>}
                    {stats.picked > 0 && <div>· {stats.picked.toLocaleString()} picked by you</div>}
                    {stats.kept > 0 && <div>· {stats.kept.toLocaleString()} kept as new values for CartUp's lists ("new values" sheet)</div>}
                    {stats.open > 0 && <div style={{ color:'#b91c1c' }}>· {stats.open.toLocaleString()} values ({stats.openValues.toLocaleString()} different) in {stats.openParents.toLocaleString()} products not on the lists yet — they'd show #N/A in payload_hidden</div>}
                  </> : <div>· Values were not checked against CartUp's lists (no template)</div>}
                  {result.ai && <div>· AI cleaned {(result.ai.products - result.ai.missed).toLocaleString()} of {result.ai.products.toLocaleString()} products{result.ai.missed ? ` — ${result.ai.missed.toLocaleString()} got the spelling fix only` : ''}{aiUse ? ` · ${aiUse.calls.toLocaleString()} request${aiUse.calls === 1 ? '' : 's'}, ${aiUse.tokens.toLocaleString()} tokens` : ''}</div>}
                  {ruleLine.length > 0 && <div>· {ruleLine.join(' · ')}</div>}
                </div>
              </details>

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
          <VariantReview result={result} decisions={decisions} setDecisions={setDecisions} memory={memory} initial={reviewing}
            onForgetMemory={() => setMemory(forgetMemory())}
            onDownload={() => download()}
            onClose={() => setReviewing(null)} />
        )}
        {sheetOpen && output && (
          <SheetEditor output={output} items={result.items} columns={SHEET_COLS} lists={result.lists} issues={issues} initialFilter={sheetOpen}
            keyOf={i => rowKey(result.items[i], i)} edits={edits} setEdits={setEdits}
            onDownload={() => download()} onClose={() => setSheetOpen(null)} />
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
