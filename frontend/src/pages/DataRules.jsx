import { useEffect, useMemo, useState } from 'react'
import { onTeamSettings, teamState, teamMeta, refreshTeamSettings, saveTeamSetting, teamHistory, restoreTeamSetting, resetTeamSetting } from '../utils/teamSettings'
import { DEFAULT_RULES, cartupCategories, categoryAttributes, darazCategories, houseRules } from '../utils/catalog'
import { readSheets, parseAttributes, parseDarazMap, parseCartupCategories, diffMaps, sameSet, downloadAttributes, downloadDarazMap, downloadCartupCategories } from '../utils/teamData'
import { getReplacements } from '../utils/wordReplacements'
import { Tags, ArrowRightLeft, FolderTree, Scale, Download, Upload, History, RotateCcw, Search, Save, X, Plus, Trash2, Loader, CheckCircle, AlertTriangle, CloudOff, Database, RefreshCw } from 'lucide-react'

// Data & Rules: the category data and house rules every page works with,
// changed here instead of in code and shared with the whole team (Team
// settings — teamSettings.js). Each part shows whether the team's copy or the
// built-in one is used, can be downloaded / uploaded as Excel (a preview of
// what changes comes first), edited one row at a time, and every saved
// version can be seen and restored.

const SQL_LINK = 'https://github.com/mojumder01/cartup-ops/blob/main/backend/sql/app_settings.sql'
const SECTIONS = [
  { key: 'category_attributes', label: 'Category attributes', Icon: Tags, what: 'Which attributes each CartUp category is mapped to — a variant attribute it needs (Color, Size, Age Group…) is always filled, or CartUp rejects the row' },
  { key: 'daraz_categories', label: 'Daraz → CartUp categories', Icon: ArrowRightLeft, what: 'The CartUp category each Daraz category becomes (Daraz Upload); mystery boxes get none' },
  { key: 'cartup_categories', label: 'CartUp categories', Icon: FolderTree, what: 'CartUp\'s categories with their path and tags — what the category columns, the AI category check, QC and Governance pick from' },
  { key: 'rules', label: 'Rules & defaults', Icon: Scale, what: 'House rules for Daraz Upload, Manual Upload and Shop Duplicate' },
]
const ATTRS = ['Color', 'Size', 'Clothing Size', 'Shoe Size', 'Bedding Size', 'Age Group', 'Model', 'Clothing Materials', 'Shoe Material', 'Bag Material', 'Dial Materials', 'Strap Materials', 'Main Materials', 'Recommended Age', 'Watch TYespe', 'ISBN/ISSN']

function useTeam() {
  const [s, set] = useState(teamState)
  useEffect(() => onTeamSettings(set), [])
  return s
}
const when = t => t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const btn = (primary, danger) => ({ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer',
  background: primary ? '#4f46e5' : '#fff', color: primary ? '#fff' : danger ? '#b91c1c' : '#4f46e5', border: primary ? 'none' : `1.5px solid ${danger ? '#fecaca' : '#c7d2fe'}` })
const input = { padding:'6px 9px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12.5, outline:'none' }
const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(15,23,42,0.06)' }
const chip = on => ({ padding:'3px 9px', borderRadius:99, fontSize:11.5, fontWeight:600, cursor:'pointer', border:`1px solid ${on ? '#4f46e5' : '#e2e8f0'}`, background: on ? '#eef2ff' : '#fff', color: on ? '#3730a3' : '#94a3b8' })

// Saves a change built on the current copy; when someone saved in between,
// their version is loaded and the change rebuilt on it, to look at and save again.
async function commit(key, compose, note) {
  try { return await saveTeamSetting(key, compose(), note) }
  catch (e) {
    if (e.code === 'conflict') { await refreshTeamSettings(); throw new Error('Someone saved a newer version a moment ago — it is loaded now, with your changes on top. Check and save again.') }
    throw e
  }
}

// Where a part's data comes from, and its buttons.
function SectionHead({ k, team, onDownload, onUpload, children }) {
  const m = teamMeta(k), s = SECTIONS.find(x => x.key === k)
  const [hist, setHist] = useState(null)
  const [busy, setBusy] = useState('')
  const canSave = team.status !== 'setup'
  const openHistory = async () => { setHist({ loading: true }); try { setHist({ rows: await teamHistory(k) }) } catch (e) { setHist({ error: e.message }) } }
  const restore = async r => {
    if (!window.confirm(`Restore version ${r.version} (${when(r.changed_at)}, ${r.changed_by || 'unknown'})? It becomes a new version; nothing is lost.`)) return
    setBusy('restore'); try { await restoreTeamSetting(k, r.id); setHist(null) } catch (e) { setHist(h => ({ ...h, error: e.message })) } setBusy('')
  }
  const reset = async () => {
    if (!window.confirm(`Go back to the built-in ${s.label.toLowerCase()} for the whole team? The team's copy stays in History and can be restored.`)) return
    setBusy('reset'); try { await resetTeamSetting(k) } catch (e) { window.alert(e.message) } setBusy('')
  }
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:12, flexWrap:'wrap', marginBottom:14 }}>
      <div style={{ flex:1, minWidth:260 }}>
        <div style={{ fontSize:12.5, color:'#64748b', lineHeight:1.5 }}>{s.what}</div>
        <div data-source={k} style={{ fontSize:12, marginTop:4, fontWeight:600, color: m.version ? '#4338ca' : '#64748b' }}>
          {m.version ? <>Team copy · version {m.version} · saved by {m.updated_by || '—'}, {when(m.updated_at)}</> : <>Built-in copy — nobody has changed it yet</>}
        </div>
        {children}
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {onDownload && <button onClick={onDownload} style={btn(false)}><Download size={13} /> Download</button>}
        {onUpload && (
          <label style={{ ...btn(false), opacity: canSave ? 1 : 0.5, pointerEvents: canSave ? 'auto' : 'none' }} title="Upload an Excel file — you see what changes before anything is saved">
            <Upload size={13} /> Upload
            <input data-upload={k} type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onUpload(f) }} />
          </label>
        )}
        <button onClick={openHistory} style={btn(false)} disabled={!canSave}><History size={13} /> History</button>
        {m.version > 0 && <button onClick={reset} disabled={!!busy} style={btn(false, true)}><RotateCcw size={13} /> Built-in</button>}
      </div>
      {hist && (
        <div onClick={() => setHist(null)} style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.35)', zIndex:120, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div data-history={k} onClick={e => e.stopPropagation()} style={{ ...card, width:'min(640px, 92vw)', maxHeight:'80vh', overflow:'auto' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <History size={16} color='#4f46e5' /><b>{s.label} — history</b>
              <button onClick={() => setHist(null)} style={{ marginLeft:'auto', border:'none', background:'none', cursor:'pointer' }}><X size={16} /></button>
            </div>
            {hist.loading && <div style={{ color:'#64748b', fontSize:12.5 }}><Loader size={13} style={{ animation:'spin 1s linear infinite' }} /> Loading…</div>}
            {hist.error && <div style={{ color:'#b91c1c', fontSize:12.5, marginBottom:8 }}>{hist.error}</div>}
            {hist.rows && !hist.rows.length && <div style={{ color:'#64748b', fontSize:12.5 }}>No saved versions — the built-in copy has always been used.</div>}
            {hist.rows?.map(r => (
              <div key={r.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderTop:'1px solid #f1f5f9', fontSize:12.5 }}>
                <span style={{ fontWeight:700, minWidth:34 }}>v{r.version}</span>
                <div style={{ flex:1 }}>
                  <div>{r.note || 'Saved'}</div>
                  <div style={{ color:'#94a3b8', fontSize:11.5 }}>{r.changed_by || '—'} · {when(r.changed_at)}</div>
                </div>
                {r.version === m.version && /^Reset/.test(r.note || '') === false ? <span style={{ color:'#16a34a', fontWeight:600, fontSize:11.5 }}>in use</span>
                  : <button onClick={() => restore(r)} disabled={!!busy} style={btn(false)}>{/^Reset/.test(r.note || '') ? 'Use built-in' : 'Restore'}</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// An uploaded file's changes, before they are saved. lines: [{ id, text }]
function UploadPreview({ preview, onApply, onCancel, busy, error }) {
  const [mode, setMode] = useState(preview.defaultMode)
  const d = mode === 'replace' ? preview.replace : preview.merge
  return (
    <div data-upload-preview style={{ border:'1.5px solid #c7d2fe', borderRadius:12, padding:14, marginBottom:14, background:'#f8faff' }}>
      <div style={{ fontWeight:700, fontSize:13, marginBottom:4 }}>{preview.file} — {preview.format}</div>
      <div style={{ display:'flex', gap:3, background:'#eef2f7', borderRadius:8, padding:3, width:'fit-content', margin:'6px 0' }}>
        {[['merge', 'Change only what the file has'], ['replace', 'Replace everything with the file']].map(([m, l]) => (
          <button key={m} onClick={() => setMode(m)} style={{ padding:'4px 10px', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background: mode === m ? '#fff' : 'transparent', color: mode === m ? '#4f46e5' : '#64748b' }}>{l}</button>
        ))}
      </div>
      <div data-upload-summary style={{ fontSize:12.5, color:'#334155' }}>
        {d.count ? <>{d.added.length.toLocaleString()} added · {d.changed.length.toLocaleString()} changed · {d.removed.length.toLocaleString()} removed</> : 'Nothing changes — the file has what is in use now'}
      </div>
      {d.count > 0 && (
        <div style={{ maxHeight:220, overflow:'auto', marginTop:8, fontSize:12, fontFamily:'ui-monospace, Menlo, monospace', background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'6px 10px' }}>
          {preview.lines(d).slice(0, 300).map((l, i) => <div key={i} style={{ color: l.kind === 'removed' ? '#b91c1c' : l.kind === 'added' ? '#15803d' : '#334155' }}>{l.text}</div>)}
          {d.count > 300 && <div style={{ color:'#94a3b8' }}>… {(d.count - 300).toLocaleString()} more</div>}
        </div>
      )}
      {error && <div style={{ color:'#b91c1c', fontSize:12.5, marginTop:8 }}>{error}</div>}
      <div style={{ display:'flex', gap:8, marginTop:10 }}>
        <button data-upload-apply disabled={!d.count || busy} onClick={() => onApply(mode)} style={{ ...btn(true), opacity: d.count ? 1 : 0.5 }}>{busy ? <Loader size={13} style={{ animation:'spin 1s linear infinite' }} /> : <Save size={13} />} Save for the team</button>
        <button onClick={onCancel} style={btn(false)}>Cancel</button>
      </div>
    </div>
  )
}

// Unsaved edits made row by row, and their save.
function SaveBar({ lines, onSave, onDiscard, busy, error }) {
  const [note, setNote] = useState('')
  if (!lines.length) return error ? <div style={{ color:'#b91c1c', fontSize:12.5, marginTop:10 }}>{error}</div> : null
  return (
    <div data-save-bar style={{ position:'sticky', bottom:0, marginTop:14, border:'1.5px solid #fde68a', background:'#fffbeb', borderRadius:12, padding:12 }}>
      <div style={{ fontSize:12.5, fontWeight:700, color:'#92400e', marginBottom:4 }}>{lines.length} unsaved change{lines.length === 1 ? '' : 's'}</div>
      <div style={{ maxHeight:110, overflow:'auto', fontSize:12, color:'#334155', fontFamily:'ui-monospace, Menlo, monospace' }}>{lines.map((l, i) => <div key={i}>{l}</div>)}</div>
      {error && <div style={{ color:'#b91c1c', fontSize:12.5, marginTop:6 }}>{error}</div>}
      <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="What changed and why (optional — shown in History)" style={{ ...input, flex:1, minWidth:220 }} />
        <button data-save onClick={() => onSave(note)} disabled={busy} style={btn(true)}>{busy ? <Loader size={13} style={{ animation:'spin 1s linear infinite' }} /> : <Save size={13} />} Save for the team</button>
        <button onClick={onDiscard} style={btn(false)}>Discard</button>
      </div>
    </div>
  )
}

// A save that reports its error and clears the edits when done.
function useSaver(key) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const run = async (compose, note, done) => {
    setBusy(true); setError('')
    try { await commit(key, compose, note); done?.() } catch (e) { setError(e.message) }
    setBusy(false)
  }
  return { busy, error, run, setError }
}

// Search: an id, or words of the path (all of them).
const matches = (q, id, path, extra = '') => {
  const t = q.trim().toLowerCase()
  if (!t) return false
  if (/^\d+$/.test(t)) return id.startsWith(t)
  return t.split(/\s+/).every(w => `${path} ${extra}`.toLowerCase().includes(w))
}

function AttributesSection({ team }) {
  const current = categoryAttributes(), cats = cartupCategories()
  const [q, setQ] = useState('4965')
  const [patch, setPatch] = useState({})   // id → [attrs] | null
  const [open, setOpen] = useState(null)
  const [preview, setPreview] = useState(null)
  const s = useSaver('category_attributes'), up = useSaver('category_attributes')
  const effective = id => patch[id] !== undefined ? patch[id] : current[id] || []
  const known = useMemo(() => [...new Set([...ATTRS, ...Object.values(current).flat()])], [current])
  const ids = useMemo(() => [...new Set([...Object.keys(current), ...Object.keys(cats)])].filter(id => matches(q, id, cats[id]?.path || '')).slice(0, 40), [q, current, cats])
  const toggle = (id, a) => setPatch(p => { const now = effective(id); const next = now.includes(a) ? now.filter(x => x !== a) : [...now, a]; return { ...p, [id]: sameSet(next, current[id] || []) && id in current ? undefined : next } })
  const lines = Object.entries(patch).filter(([, v]) => v !== undefined).map(([id, v]) => {
    const was = current[id] || [], add = v.filter(a => !was.includes(a)), del = was.filter(a => !v.includes(a))
    return `${id} ${cats[id]?.path?.split('>').pop().trim() || ''}: ${[...add.map(a => `+ ${a}`), ...del.map(a => `− ${a}`)].join(', ')}`
  })
  const compose = () => {
    const base = categoryAttributes(), out = { ...base }
    for (const [id, v] of Object.entries(patch)) if (v !== undefined) { if (v.length) out[id] = v; else delete out[id] }
    return out
  }
  const upload = async f => {
    up.setError('')
    try {
      const r = parseAttributes(await readSheets(f), known)
      const merged = { ...current, ...r.value }
      setPreview({ file: f.name, format: r.format, value: r.value, defaultMode: Object.keys(r.value).length >= Object.keys(current).length * 0.9 ? 'replace' : 'merge',
        merge: diffMaps(current, merged, sameSet), replace: diffMaps(current, r.value, sameSet),
        lines: d => [...d.changed.map(id => { const was = current[id] || [], v = r.value[id]; return { kind: 'changed', text: `${id} ${cats[id]?.path || ''}: ${[...v.filter(a => !was.includes(a)).map(a => `+ ${a}`), ...was.filter(a => !v.includes(a)).map(a => `− ${a}`)].join(', ')}` } }),
          ...d.added.map(id => ({ kind: 'added', text: `${id} ${cats[id]?.path || '(not in CartUp categories)'}: ${r.value[id].join(', ')}` })),
          ...d.removed.map(id => ({ kind: 'removed', text: `${id} ${cats[id]?.path || ''}: no attributes (was ${current[id].join(', ')})` }))] })
    } catch (e) { up.setError(e.message) }
  }
  return (
    <>
      <SectionHead k="category_attributes" team={team} onDownload={() => downloadAttributes(Object.fromEntries(Object.keys({ ...current, ...patch }).map(id => [id, effective(id)]).filter(([, v]) => v.length)), cats)} onUpload={upload}>
        <div style={{ fontSize:11.5, color:'#94a3b8', marginTop:2 }}>{Object.keys(current).length.toLocaleString()} categories · Upload takes the Attribute_Check file as it is ("Category Wise Attribute match" sheet)</div>
      </SectionHead>
      {up.error && !preview && <div style={{ color:'#b91c1c', fontSize:12.5, marginBottom:10 }}>{up.error}</div>}
      {preview && <UploadPreview preview={preview} busy={up.busy} error={up.error} onCancel={() => setPreview(null)}
        onApply={mode => up.run(() => mode === 'replace' ? preview.value : { ...categoryAttributes(), ...preview.value }, `Upload ${preview.file} (${mode === 'replace' ? 'replaced everything' : 'changed only what the file has'})`, () => setPreview(null))} />}
      <SearchBox q={q} setQ={setQ} placeholder="Category id (4965) or words of its path (umbrella boys)" />
      {ids.map(id => (
        <div key={id} data-attr-row={id} style={{ borderTop:'1px solid #f1f5f9', padding:'8px 0' }}>
          <div onClick={() => setOpen(o => o === id ? null : id)} style={{ display:'flex', gap:10, alignItems:'center', cursor:'pointer', flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:12.5, minWidth:46 }}>{id}</span>
            <span style={{ fontSize:12.5, color:'#334155', flex:1, minWidth:200 }}>{cats[id]?.path || <i style={{ color:'#b45309' }}>not in CartUp categories</i>}</span>
            <span style={{ display:'flex', gap:4, flexWrap:'wrap' }}>{effective(id).map(a => <span key={a} style={chip(true)}>{a}</span>)}{!effective(id).length && <span style={{ fontSize:11.5, color:'#94a3b8' }}>no attributes</span>}</span>
          </div>
          {open === id && (
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginTop:8, paddingLeft:56 }}>
              {known.map(a => <button key={a} data-attr-toggle={a} onClick={() => toggle(id, a)} style={chip(effective(id).includes(a))}>{effective(id).includes(a) ? '✓ ' : '+ '}{a}</button>)}
            </div>
          )}
        </div>
      ))}
      {q.trim() && !ids.length && <div style={{ fontSize:12.5, color:'#94a3b8', padding:'8px 0' }}>No category matches</div>}
      <SaveBar lines={lines} busy={s.busy} error={s.error} onDiscard={() => setPatch({})} onSave={note => s.run(compose, note || `Edited ${lines.length} categor${lines.length === 1 ? 'y' : 'ies'}`, () => setPatch({}))} />
    </>
  )
}

function SearchBox({ q, setQ, placeholder }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, border:'1.5px solid #e2e8f0', borderRadius:9, padding:'6px 10px', marginBottom:6 }}>
      <Search size={14} color='#94a3b8' />
      <input data-search value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} style={{ border:'none', outline:'none', fontSize:13, flex:1 }} />
      {q && <button onClick={() => setQ('')} style={{ border:'none', background:'none', cursor:'pointer', color:'#94a3b8' }}><X size={14} /></button>}
    </div>
  )
}

function DarazSection({ team }) {
  const current = darazCategories(), cats = cartupCategories()
  const [q, setQ] = useState('')
  const [patch, setPatch] = useState({})   // Daraz id → CartUp id | null (removed)
  const [add, setAdd] = useState({ d: '', c: '' })
  const [lists, setLists] = useState(null)   // { mystery, manual } being edited (text)
  const [preview, setPreview] = useState(null)
  const s = useSaver('daraz_categories'), up = useSaver('daraz_categories')
  const effective = d => d in patch ? patch[d] : current.map[d]
  const rows = useMemo(() => Object.keys({ ...current.map, ...patch }).filter(d => effective(d) != null && matches(q, d, cats[effective(d)]?.path || '', effective(d))).slice(0, 40), [q, current, patch, cats])
  const lines = [
    ...Object.entries(patch).map(([d, c]) => c == null ? `${d}: removed (was → ${current.map[d]})` : current.map[d] ? `${d}: ${current.map[d]} → ${c} ${cats[c]?.path || '(not in CartUp categories)'}` : `${d}: new → ${c} ${cats[c]?.path || '(not in CartUp categories)'}`),
    ...(lists ? ['Mystery / by-hand lists changed'] : []),
  ]
  const compose = () => {
    const base = darazCategories(), map = { ...base.map }
    for (const [d, c] of Object.entries(patch)) if (c == null) delete map[d]; else map[d] = c
    const split = t => t.split(/[\s,]+/).filter(x => /^\d+$/.test(x))
    return { map, mystery: lists ? split(lists.mystery) : base.mystery || [], manual: lists ? split(lists.manual) : base.manual || [] }
  }
  const upload = async f => {
    up.setError('')
    try {
      const r = parseDarazMap(await readSheets(f))
      setPreview({ file: f.name, format: `sheet "${r.sheet}"`, value: r.map, defaultMode: 'merge',
        merge: diffMaps(current.map, { ...current.map, ...r.map }), replace: diffMaps(current.map, r.map),
        lines: d => [...d.changed.map(k => ({ kind: 'changed', text: `${k}: ${current.map[k]} → ${r.map[k]} ${cats[r.map[k]]?.path || '(not in CartUp categories)'}` })),
          ...d.added.map(k => ({ kind: 'added', text: `${k}: new → ${r.map[k]} ${cats[r.map[k]]?.path || '(not in CartUp categories)'}` })),
          ...d.removed.map(k => ({ kind: 'removed', text: `${k}: removed (was → ${current.map[k]})` }))] })
    } catch (e) { up.setError(e.message) }
  }
  const missing = Object.values(current.map).filter(c => !cats[c]).length
  return (
    <>
      <SectionHead k="daraz_categories" team={team} onDownload={() => downloadDarazMap(compose(), cats)} onUpload={upload}>
        <div style={{ fontSize:11.5, color:'#94a3b8', marginTop:2 }}>
          {Object.keys(current.map).length.toLocaleString()} Daraz categories mapped · {(current.mystery || []).length} mystery box · {(current.manual || []).length} mapped by hand
          {missing > 0 && <span style={{ color:'#b45309' }}> · {missing} point to a CartUp category that isn't in the list</span>}
          {' · '}Upload: a "Daraz Category Id" and a "CartUp Category Id" column
        </div>
      </SectionHead>
      {up.error && !preview && <div style={{ color:'#b91c1c', fontSize:12.5, marginBottom:10 }}>{up.error}</div>}
      {preview && <UploadPreview preview={preview} busy={up.busy} error={up.error} onCancel={() => setPreview(null)}
        onApply={mode => up.run(() => { const b = darazCategories(); return { ...b, map: mode === 'replace' ? preview.value : { ...b.map, ...preview.value } } }, `Upload ${preview.file} (${mode === 'replace' ? 'replaced everything' : 'changed only what the file has'})`, () => setPreview(null))} />}
      <SearchBox q={q} setQ={setQ} placeholder="Daraz category id, CartUp category id, or words of the CartUp path" />
      {rows.map(d => (
        <div key={d} data-map-row={d} style={{ display:'flex', gap:10, alignItems:'center', borderTop:'1px solid #f1f5f9', padding:'6px 0', flexWrap:'wrap' }}>
          <span style={{ fontWeight:700, fontSize:12.5, minWidth:80 }}>{d}</span><span style={{ color:'#94a3b8' }}>→</span>
          <input value={effective(d)} onChange={e => setPatch(p => ({ ...p, [d]: e.target.value.trim() }))} style={{ ...input, width:80 }} aria-label={`CartUp category for Daraz ${d}`} />
          <span style={{ fontSize:12.5, flex:1, minWidth:200, color: cats[effective(d)] ? '#334155' : '#b45309' }}>{cats[effective(d)]?.path || 'not in CartUp categories'}</span>
          <button onClick={() => setPatch(p => ({ ...p, [d]: null }))} title="Remove this mapping" style={{ border:'none', background:'none', cursor:'pointer', color:'#dc2626' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:12.5, fontWeight:600 }}>Add</span>
        <input value={add.d} onChange={e => setAdd(a => ({ ...a, d: e.target.value.trim() }))} placeholder="Daraz category id" style={{ ...input, width:140 }} />
        <span style={{ color:'#94a3b8' }}>→</span>
        <input value={add.c} onChange={e => setAdd(a => ({ ...a, c: e.target.value.trim() }))} placeholder="CartUp category id" style={{ ...input, width:140 }} />
        <span style={{ fontSize:12, color: cats[add.c] ? '#15803d' : '#94a3b8' }}>{add.c ? cats[add.c]?.path || 'not in CartUp categories' : ''}</span>
        <button disabled={!/^\d+$/.test(add.d) || !/^\d+$/.test(add.c)} onClick={() => { setPatch(p => ({ ...p, [add.d]: add.c })); setQ(add.d); setAdd({ d: '', c: '' }) }} style={btn(false)}><Plus size={13} /> Add</button>
      </div>
      <details style={{ marginTop:12 }} onToggle={e => e.currentTarget.open && !lists && setLists({ mystery: (current.mystery || []).join(', '), manual: (current.manual || []).join(', ') })}>
        <summary style={{ cursor:'pointer', fontSize:12.5, fontWeight:600, color:'#4f46e5' }}>Mystery boxes and categories mapped by hand</summary>
        {lists && (
          <div style={{ display:'grid', gap:8, marginTop:8 }}>
            <label style={{ fontSize:12 }}>Mystery / surprise box Daraz categories (no CartUp category — filled by hand)<textarea value={lists.mystery} onChange={e => setLists(l => ({ ...l, mystery: e.target.value }))} rows={2} style={{ ...input, width:'100%', display:'block', marginTop:4 }} /></label>
            <label style={{ fontSize:12 }}>Mapped by hand (Report says so)<textarea value={lists.manual} onChange={e => setLists(l => ({ ...l, manual: e.target.value }))} rows={2} style={{ ...input, width:'100%', display:'block', marginTop:4 }} /></label>
          </div>
        )}
      </details>
      <SaveBar lines={lines} busy={s.busy} error={s.error} onDiscard={() => { setPatch({}); setLists(null) }} onSave={note => s.run(compose, note || `Edited ${lines.length} mapping${lines.length === 1 ? '' : 's'}`, () => { setPatch({}); setLists(null) })} />
    </>
  )
}

function CartupSection({ team }) {
  const current = cartupCategories()
  const [q, setQ] = useState('')
  const [patch, setPatch] = useState({})   // id → { path, tags } | null
  const [add, setAdd] = useState({ id: '', path: '', tags: '' })
  const [preview, setPreview] = useState(null)
  const s = useSaver('cartup_categories'), up = useSaver('cartup_categories')
  const effective = id => id in patch ? patch[id] : current[id]
  const ids = useMemo(() => Object.keys({ ...current, ...patch }).filter(id => effective(id) && matches(q, id, effective(id).path, effective(id).tags)).slice(0, 40), [q, current, patch])
  const lines = Object.entries(patch).map(([id, v]) => v == null ? `${id}: removed (${current[id]?.path})` : current[id] ? `${id}: ${v.path}${v.tags !== current[id].tags ? ' · tags changed' : ''}` : `${id}: new — ${v.path}`)
  const compose = () => { const out = { ...cartupCategories() }; for (const [id, v] of Object.entries(patch)) if (v == null) delete out[id]; else out[id] = v; return out }
  const edit = (id, field, val) => setPatch(p => ({ ...p, [id]: { ...effective(id), [field]: val } }))
  const upload = async f => {
    up.setError('')
    try {
      const r = parseCartupCategories(await readSheets(f))
      setPreview({ file: f.name, format: `sheet "${r.sheet}"`, value: r.cats, defaultMode: 'merge',
        merge: diffMaps(current, { ...current, ...r.cats }), replace: diffMaps(current, r.cats),
        lines: d => [...d.changed.map(k => ({ kind: 'changed', text: `${k}: ${current[k].path === r.cats[k].path ? r.cats[k].path + ' · tags changed' : `${current[k].path} → ${r.cats[k].path}`}` })),
          ...d.added.map(k => ({ kind: 'added', text: `${k}: new — ${r.cats[k].path}` })), ...d.removed.map(k => ({ kind: 'removed', text: `${k}: removed (${current[k].path})` }))] })
    } catch (e) { up.setError(e.message) }
  }
  return (
    <>
      <SectionHead k="cartup_categories" team={team} onDownload={() => downloadCartupCategories(compose())} onUpload={upload}>
        <div style={{ fontSize:11.5, color:'#94a3b8', marginTop:2 }}>{Object.keys(current).length.toLocaleString()} categories · Upload: "ID", "Path" and "Tags" columns</div>
      </SectionHead>
      {up.error && !preview && <div style={{ color:'#b91c1c', fontSize:12.5, marginBottom:10 }}>{up.error}</div>}
      {preview && <UploadPreview preview={preview} busy={up.busy} error={up.error} onCancel={() => setPreview(null)}
        onApply={mode => up.run(() => mode === 'replace' ? preview.value : { ...cartupCategories(), ...preview.value }, `Upload ${preview.file} (${mode === 'replace' ? 'replaced everything' : 'changed only what the file has'})`, () => setPreview(null))} />}
      <SearchBox q={q} setQ={setQ} placeholder="Category id, or words of its path or tags" />
      {ids.map(id => (
        <div key={id} data-cat-row={id} style={{ display:'grid', gridTemplateColumns:'60px 1fr 1fr 24px', gap:8, alignItems:'center', borderTop:'1px solid #f1f5f9', padding:'6px 0' }}>
          <span style={{ fontWeight:700, fontSize:12.5 }}>{id}</span>
          <input value={effective(id).path} onChange={e => edit(id, 'path', e.target.value)} style={input} aria-label={`Path of ${id}`} />
          <input value={effective(id).tags || ''} onChange={e => edit(id, 'tags', e.target.value)} style={input} aria-label={`Tags of ${id}`} placeholder="tags, comma separated" />
          <button onClick={() => setPatch(p => ({ ...p, [id]: null }))} title="Remove this category" style={{ border:'none', background:'none', cursor:'pointer', color:'#dc2626' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <div style={{ display:'grid', gridTemplateColumns:'90px 1fr 1fr auto', gap:8, alignItems:'center', marginTop:10 }}>
        <input value={add.id} onChange={e => setAdd(a => ({ ...a, id: e.target.value.trim() }))} placeholder="New id" style={input} />
        <input value={add.path} onChange={e => setAdd(a => ({ ...a, path: e.target.value }))} placeholder="Path — Fashion > Boys > Accessories > Umbrellas" style={input} />
        <input value={add.tags} onChange={e => setAdd(a => ({ ...a, tags: e.target.value }))} placeholder="tags, comma separated" style={input} />
        <button disabled={!/^\d+$/.test(add.id) || !add.path.trim() || !!current[add.id]} onClick={() => { setPatch(p => ({ ...p, [add.id]: { path: add.path.trim(), tags: add.tags.trim() } })); setQ(add.id); setAdd({ id: '', path: '', tags: '' }) }} style={btn(false)} title={current[add.id] ? 'This id exists — edit it above' : ''}><Plus size={13} /> Add</button>
      </div>
      <SaveBar lines={lines} busy={s.busy} error={s.error} onDiscard={() => setPatch({})} onSave={note => s.run(compose, note || `Edited ${lines.length} categor${lines.length === 1 ? 'y' : 'ies'}`, () => setPatch({}))} />
    </>
  )
}

function RulesSection({ team }) {
  const fresh = () => ({ ...houseRules(), wordReplacements: getReplacements().map(r => ({ ...r })) })
  const [form, setForm] = useState(fresh)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (!dirty) setForm(fresh()) }, [team.meta.rules?.version])
  const s = useSaver('rules')
  const setF = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true) }
  const cur = fresh()
  const lines = dirty ? [
    ...Object.keys(form.fillDefaults).filter(c => form.fillDefaults[c] !== cur.fillDefaults[c]).map(c => `Empty ${c} → "${form.fillDefaults[c]}" (was "${cur.fillDefaults[c]}")`),
    ...['discountLimit', 'stockCap', 'hashTo'].filter(k => String(form[k]) !== String(cur[k])).map(k => `${{ discountLimit: 'Special price removed at a discount of', stockCap: 'Stock cap', hashTo: '"#" in names becomes' }[k]} ${form[k]} (was ${cur[k]})`),
    ...(JSON.stringify(form.wordReplacements.filter(r => r.find)) !== JSON.stringify(cur.wordReplacements) ? ['Word replacements changed'] : []),
    ...((form.partsToName !== false) !== (cur.partsToName !== false) ? [`Combo parts with no column → name: ${form.partsToName !== false ? 'on' : 'off'}`] : []),
  ] : []
  const compose = () => ({ fillDefaults: form.fillDefaults, discountLimit: Math.min(100, Math.max(1, Number(form.discountLimit) || DEFAULT_RULES.discountLimit)),
    stockCap: Math.max(0, Math.round(Number(form.stockCap) || DEFAULT_RULES.stockCap)), hashTo: String(form.hashTo ?? '-'), wordReplacements: form.wordReplacements.filter(r => r.find.trim()),
    partsToName: form.partsToName !== false })
  const label = { fontSize:12, fontWeight:600, color:'#475569' }
  return (
    <>
      <SectionHead k="rules" team={team} />
      <div style={{ display:'grid', gap:16 }}>
        <div>
          <div style={label}>A variant column the category needs but the seller left empty gets</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8, marginTop:6 }}>
            {Object.keys(DEFAULT_RULES.fillDefaults).map(c => (
              <label key={c} style={{ fontSize:12, color:'#64748b' }}>{c}
                <input data-fill={c} value={form.fillDefaults[c] ?? ''} onChange={e => setF('fillDefaults', { ...form.fillDefaults, [c]: e.target.value })} style={{ ...input, width:'100%', display:'block', marginTop:3 }} />
              </label>
            ))}
          </div>
          <div style={{ fontSize:11.5, color:'#94a3b8', marginTop:4 }}>The value must be on CartUp's list for that column (the template) — e.g. Age Group's only neutral one is "One Size"</div>
        </div>
        <label style={{ ...label, display:'flex', gap:8, alignItems:'flex-start', cursor:'pointer' }}>
          <input data-rule="partsToName" type="checkbox" checked={form.partsToName !== false} onChange={e => setF('partsToName', e.target.checked)} style={{ accentColor:'#4f46e5', marginTop:2 }} />
          <span>Keep a Variations Combo part that has no column in the category in the product name — when every SKU of the product has it ("Grey,8TB" for External Hard Drives, Color only → "… (8TB)"; CartUp has one name per Parent SKU)
            <span style={{ display:'block', fontWeight:400, color:'#94a3b8' }}>Off: the part is only noted in Report ("Not used from Variations Combo"). Parts that differ between SKUs always stay with the variant values.</span></span>
        </label>
        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
          <label style={label}>Remove a special price at a discount of<br /><input data-rule="discountLimit" type="number" min={1} max={100} value={form.discountLimit} onChange={e => setF('discountLimit', e.target.value)} style={{ ...input, width:80, marginTop:3 }} /> % or more</label>
          <label style={label}>Stock never above<br /><input data-rule="stockCap" type="number" min={0} value={form.stockCap} onChange={e => setF('stockCap', e.target.value)} style={{ ...input, width:110, marginTop:3 }} /></label>
          <label style={label}>"#" in names becomes<br /><input data-rule="hashTo" value={form.hashTo} maxLength={3} onChange={e => setF('hashTo', e.target.value)} style={{ ...input, width:60, marginTop:3 }} /> <span style={{ fontWeight:400, color:'#94a3b8' }}>("#" keeps it)</span></label>
        </div>
        <div>
          <div style={label}>Word replacements — in names, highlights and descriptions (never inside links or HTML tags; capitals kept)</div>
          {form.wordReplacements.map((r, i) => (
            <div key={i} style={{ display:'flex', gap:8, alignItems:'center', marginTop:6 }}>
              <input value={r.find} onChange={e => setF('wordReplacements', form.wordReplacements.map((x, j) => j === i ? { ...x, find: e.target.value } : x))} placeholder="find" style={{ ...input, width:180 }} />
              <span style={{ color:'#94a3b8' }}>→</span>
              <input value={r.replace} onChange={e => setF('wordReplacements', form.wordReplacements.map((x, j) => j === i ? { ...x, replace: e.target.value } : x))} placeholder="replace with" style={{ ...input, width:180 }} />
              <button onClick={() => setF('wordReplacements', form.wordReplacements.filter((_, j) => j !== i))} style={{ border:'none', background:'none', cursor:'pointer', color:'#dc2626' }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setF('wordReplacements', [...form.wordReplacements, { find: '', replace: '' }])} style={{ ...btn(false), marginTop:6 }}><Plus size={13} /> Add a word</button>
        </div>
      </div>
      <SaveBar lines={lines} busy={s.busy} error={s.error} onDiscard={() => { setForm(fresh()); setDirty(false) }} onSave={note => s.run(compose, note || 'Rules changed', () => setDirty(false))} />
    </>
  )
}

export default function DataRules() {
  const team = useTeam()
  const [tab, setTab] = useState('category_attributes')
  useEffect(() => { refreshTeamSettings() }, [])
  const Section = { category_attributes: AttributesSection, daraz_categories: DarazSection, cartup_categories: CartupSection, rules: RulesSection }[tab]
  return (
    <div style={{ padding:'32px 36px', maxWidth:1100 }}>
      <div style={{ marginBottom:18 }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:'#1a202c', display:'flex', alignItems:'center', gap:8 }}><Database size={20} color='#4f46e5' /> Data &amp; Rules</h1>
        <p style={{ color:'#718096', marginTop:4, fontSize:13 }}>The category data and house rules every page works with — change them here, for the whole team. Every change is kept and can be restored.</p>
      </div>
      <div data-team-status={team.status} style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 14px', borderRadius:10, fontSize:12.5, marginBottom:16,
        background: { setup: '#fffbeb', offline: '#fef2f2', ready: '#f0fdf4' }[team.status] || '#f8fafc', color: { setup: '#92400e', offline: '#b91c1c', ready: '#166534' }[team.status] || '#475569' }}>
        {team.status === 'loading' ? <Loader size={14} style={{ animation:'spin 1s linear infinite' }} /> : team.status === 'ready' ? <CheckCircle size={14} /> : team.status === 'setup' ? <AlertTriangle size={14} /> : team.status === 'offline' ? <CloudOff size={14} /> : <Database size={14} />}
        <span style={{ flex:1 }}>
          {team.status === 'loading' ? 'Checking the team\'s settings…'
            : team.status === 'ready' ? `Up to date with the team${team.checkedAt ? ` · checked ${new Date(team.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
            : team.status === 'setup' ? <>Team settings aren't set up yet — until then the built-in data is used and nothing can be saved. {/updates from main/.test(team.error) ? <>{team.error}; then </> : null}Once, in Supabase → SQL Editor, run <a href={SQL_LINK} target="_blank" rel="noreferrer">backend/sql/app_settings.sql</a>, then Retry.</>
            : team.status === 'offline' ? `The server can't be reached — the last copy loaded in this browser is used; saving needs the server. ${team.error || ''}`
            : 'Using this browser\'s last copy'}
        </span>
        {team.status !== 'loading' && <button onClick={() => refreshTeamSettings()} style={{ ...btn(false), padding:'3px 10px' }}><RefreshCw size={12} /> Retry</button>}
      </div>
      <div style={{ display:'flex', gap:4, marginBottom:16, background:'#f1f5f9', borderRadius:10, padding:4, width:'fit-content', flexWrap:'wrap' }}>
        {SECTIONS.map(({ key, label, Icon }) => (
          <button key={key} data-tab={key} onClick={() => setTab(key)} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:7, border:'none', fontSize:13, fontWeight:600, cursor:'pointer',
            background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#4f46e5' : '#718096', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            <Icon size={14} /> {label}{teamMeta(key).version ? <span style={{ fontSize:10.5, color:'#6366f1' }}>· team v{teamMeta(key).version}</span> : null}
          </button>
        ))}
      </div>
      <div style={card}><Section key={tab} team={team} /></div>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
