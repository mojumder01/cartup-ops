import { useEffect, useMemo, useState } from 'react'
import { Search, Loader, XCircle, ListFilter } from 'lucide-react'
import { DARAZ_FILES, cell } from '../utils/darazFiles'
import { templateLists } from '../utils/processor'
import { zoomProps, HoverZoomToggle } from './HoverZoom'

// The picked files on Daraz Upload, as read: the rows the file check already
// read (nothing is read again), the columns the processing uses highlighted,
// the rows the check counted as problems one click away; the CartUp template
// as its dropdown lists; the image key file with the columns mapped to images.

const text = v => (v === undefined || v === null ? '' : String(v).trim())
const IMAGE = /^https?:\/\/\S+?\.(?:jpe?g|png|webp|gif)(?:[_?#.]\S*)?$/i
const shown = v => { const t = text(v); return t.includes('<') ? t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : t }
const PAGE = 60

// Rows the file check counts (and a few worth seeing), per kind of file.
function problemsFor(kind, rows) {
  if (kind === 'price') {
    const seen = new Map()
    for (const r of rows) { const s = text(r.SellerSKU); if (s) seen.set(s, (seen.get(s) || 0) + 1) }
    return [
      { id: 'pid', label: 'No Product ID', test: r => !text(r['Product ID']) },
      { id: 'sku', label: 'No Seller SKU', test: r => !text(r.SellerSKU) },
      { id: 'dup', label: 'Repeated Seller SKU', test: r => seen.get(text(r.SellerSKU)) > 1 },
      { id: 'price', label: 'No price', test: r => !cell(r, ...DARAZ_FILES.price.price) },
      { id: 'name', label: 'No name', test: r => !text(r['*Product Name(English)']) },
      { id: 'inactive', label: 'Not active', test: r => text(r.status).toLowerCase() !== 'active', info: true },
    ]
  }
  if (kind === 'basic') return [{ id: 'img', label: 'No Image 1', test: r => !text(r['*Product Images1']) }]
  if (kind === 'weight') return [{ id: 'weight', label: 'No weight', test: r => !text(r['*Package Weight (kg)']) }]
  if (kind === 'skuimg') return [{ id: 'img', label: 'No Images1', test: r => !text(r.Images1), info: true }]
  if (kind === 'attr') return [{ id: 'brand', label: 'No brand (→ No Brand)', test: r => !text(r.Brand), info: true }]
  return []
}

// A sheet's rows: search, problem filters, used columns only, PAGE rows at a time.
// marks: column → what it is used for (a badge under the header).
export function RowsTable({ columns, rows, used = new Set(), marks = {}, problems = [], header = c => c }) {
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(() => columns.some(c => used.has(c) || marks[c]))
  const [filter, setFilter] = useState(null)
  const [limit, setLimit] = useState(PAGE)
  const cols = only ? columns.filter(c => used.has(c) || marks[c]) : columns
  const counts = useMemo(() => Object.fromEntries(problems.map(p => [p.id, rows.filter(p.test).length])), [rows, problems])
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase(), test = problems.find(p => p.id === filter)?.test
    const out = []
    rows.forEach((r, i) => { if ((!test || test(r)) && (!needle || cols.some(c => text(r[c]).toLowerCase().includes(needle)))) out.push(i) })
    return out
  }, [rows, q, filter, only, problems])
  useEffect(() => setLimit(PAGE), [q, filter, only])
  const hasImages = useMemo(() => rows.slice(0, 20).some(r => cols.some(c => IMAGE.test(text(r[c])))), [rows, only])

  const chip = (on, color) => ({ display:'flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:99, fontSize:11.5, fontWeight:600, cursor:'pointer',
    border:`1px solid ${on ? color : '#e2e8f0'}`, background: on ? color : '#fff', color: on ? '#fff' : '#475569', whiteSpace:'nowrap' })
  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0, flex:1 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', padding:'8px 12px', borderBottom:'1px solid #f1f5f9' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, border:'1.5px solid #e2e8f0', borderRadius:8, padding:'4px 8px', flex:'1 1 160px', minWidth:140 }}>
          <Search size={13} color='#94a3b8' />
          <input data-preview-search value={q} onChange={e => setQ(e.target.value)} placeholder="Search rows…" style={{ border:'none', outline:'none', fontSize:12, flex:1, minWidth:0 }} />
        </div>
        {columns.some(c => used.has(c) || marks[c]) && (
          <div style={{ display:'flex', gap:2, background:'#eef2f7', borderRadius:8, padding:2 }}>
            {[[true, `Used columns (${columns.filter(c => used.has(c) || marks[c]).length})`], [false, `All (${columns.length})`]].map(([v, l]) => (
              <button key={l} onClick={() => setOnly(v)} style={{ padding:'3px 9px', border:'none', borderRadius:6, fontSize:11.5, fontWeight:600, cursor:'pointer',
                background: only === v ? '#fff' : 'transparent', color: only === v ? '#4f46e5' : '#64748b', boxShadow: only === v ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}>{l}</button>
            ))}
          </div>
        )}
        {hasImages && <HoverZoomToggle />}
      </div>
      {problems.some(p => counts[p.id]) && (
        <div data-preview-problems style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', padding:'6px 12px', borderBottom:'1px solid #f1f5f9' }}>
          <ListFilter size={13} color='#94a3b8' />
          {problems.filter(p => counts[p.id]).map(p => (
            <button key={p.id} onClick={() => setFilter(f => f === p.id ? null : p.id)} style={chip(filter === p.id, p.info ? '#64748b' : '#d97706')}>
              {p.label} <span style={{ opacity:0.8 }}>{counts[p.id].toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ flex:1, overflow:'auto', minHeight:0 }}>
        <table data-preview-table style={{ borderCollapse:'separate', borderSpacing:0, fontSize:11.5, width:'max-content', minWidth:'100%' }}>
          <thead>
            <tr>
              <th style={{ position:'sticky', top:0, left:0, zIndex:3, background:'#f8fafc', borderBottom:'1px solid #e2e8f0', padding:'6px 8px', color:'#94a3b8', fontWeight:600, textAlign:'right' }}>#</th>
              {cols.map(c => (
                <th key={c} style={{ position:'sticky', top:0, zIndex:2, background: used.has(c) || marks[c] ? '#eef2ff' : '#f8fafc', borderBottom:'1px solid #e2e8f0', padding:'6px 10px',
                  textAlign:'left', fontWeight:700, color: used.has(c) || marks[c] ? '#3730a3' : '#64748b', whiteSpace:'nowrap', verticalAlign:'top' }}
                  title={used.has(c) ? 'Read by the processing' : marks[c] ? `Used as ${marks[c]}` : 'Not used'}>
                  {header(c)}
                  {marks[c] && <div style={{ fontSize:10, fontWeight:600, color:'#4f46e5', marginTop:2 }}>→ {marks[c]}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hits.slice(0, limit).map(i => (
              <tr key={i}>
                <td style={{ position:'sticky', left:0, background:'#fff', borderBottom:'1px solid #f1f5f9', padding:'4px 8px', color:'#94a3b8', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{i + 1}</td>
                {cols.map(c => {
                  const v = text(rows[i][c])
                  if (IMAGE.test(v)) return (
                    <td key={c} style={{ borderBottom:'1px solid #f1f5f9', padding:'3px 10px' }}>
                      <img src={v} alt="" loading="lazy" {...zoomProps(v)} style={{ width:34, height:34, objectFit:'cover', borderRadius:5, border:'1px solid #e2e8f0', display:'block', background:'#f8fafc' }} />
                    </td>
                  )
                  const t = shown(v)
                  return (
                    <td key={c} title={t.length > 60 ? t.slice(0, 1000) : undefined} style={{ borderBottom:'1px solid #f1f5f9', padding:'4px 10px', maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: t ? '#1e293b' : '#cbd5e1' }}>
                      {t ? (t.length > 90 ? t.slice(0, 90) + '…' : t) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!hits.length && <div style={{ padding:24, textAlign:'center', color:'#94a3b8', fontSize:12.5 }}>No rows match</div>}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 12px', borderTop:'1px solid #f1f5f9', fontSize:11.5, color:'#64748b' }}>
        Showing {Math.min(limit, hits.length).toLocaleString()} of {hits.length.toLocaleString()} row{hits.length === 1 ? '' : 's'}{hits.length < rows.length ? ` (${rows.length.toLocaleString()} in the file)` : ''}
        {hits.length > limit && <button onClick={() => setLimit(l => l + 200)} style={{ marginLeft:'auto', border:'1px solid #c7d2fe', background:'#fff', color:'#4f46e5', borderRadius:6, padding:'2px 10px', fontSize:11.5, fontWeight:600, cursor:'pointer' }}>Show 200 more</button>}
      </div>
    </div>
  )
}

// The CartUp template: its dropdown lists — how many values each, and is a value on it?
function TemplateLists({ file }) {
  const [lists, setLists] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    templateLists(file).then(l => live && setLists(l), e => live && setError(e.message))
    return () => { live = false }
  }, [file])
  const all = useMemo(() => lists ? Object.entries(lists).map(([key, m]) => ({ key, label: m.label || key, values: m.entries() })) : [], [lists])
  const needle = q.trim().toLowerCase()
  const found = useMemo(() => Object.fromEntries(all.map(l => [l.key, needle ? l.values.filter(v => v.toLowerCase().includes(needle)) : l.values])), [all, needle])
  if (error) return <div style={{ padding:16, color:'#b91c1c', fontSize:12.5 }}>{error}</div>
  if (!lists) return <div style={{ padding:16, color:'#64748b', fontSize:12.5, display:'flex', gap:6, alignItems:'center' }}><Loader size={13} style={{ animation:'spin 1s linear infinite' }} /> Reading the lists…</div>
  // Searching: the chosen list, or the first that has the value.
  const cur = (needle && !found[open]?.length && all.find(l => found[l.key].length)) || all.find(l => l.key === open) || all[0]
  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0, flex:1 }}>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid #f1f5f9' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, border:'1.5px solid #e2e8f0', borderRadius:8, padding:'4px 8px' }}>
          <Search size={13} color='#94a3b8' />
          <input data-preview-search value={q} onChange={e => setQ(e.target.value)} placeholder="Is a value on CartUp's lists? (e.g. Navy Blue, 42 (EU))" style={{ border:'none', outline:'none', fontSize:12, flex:1, minWidth:0 }} />
        </div>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'8px 12px', borderBottom:'1px solid #f1f5f9' }}>
        {all.map(l => {
          const on = l.key === cur?.key, n = found[l.key].length
          return (
            <button key={l.key} data-template-list={l.label} onClick={() => setOpen(l.key)} style={{ padding:'4px 10px', borderRadius:8, fontSize:11.5, fontWeight:600, cursor:'pointer',
              border:`1px solid ${on ? '#4f46e5' : '#e2e8f0'}`, background: on ? '#eef2ff' : '#fff', color: needle && !n ? '#cbd5e1' : on ? '#3730a3' : '#475569' }}>
              {l.label} <span style={{ fontWeight:500, color:'#94a3b8' }}>{(needle ? n : l.values.length).toLocaleString()}</span>
            </button>
          )
        })}
      </div>
      {cur && (
        <div style={{ flex:1, overflow:'auto', padding:'8px 12px', minHeight:0 }}>
          <div style={{ fontSize:11.5, color:'#64748b', marginBottom:6 }}>
            <b style={{ color:'#1a202c' }}>{cur.label}</b> — {needle ? `${found[cur.key].length.toLocaleString()} of ${cur.values.length.toLocaleString()} values contain "${q.trim()}"` : `${cur.values.length.toLocaleString()} values`}
            {found[cur.key].length > 400 ? ' · first 400 shown' : ''}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {found[cur.key].slice(0, 400).map(v => <span key={v} style={{ padding:'2px 8px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:6, fontSize:11.5, color:'#334155' }}>{v}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

// One picked file. kind: price | basic | weight | skuimg | attr | template | keys.
// check: the file check's result (columns, rows…); keySheet / keyMarks: the image key file.
export default function FilePreview({ kind, file, check, checking, keySheet, keyMarks = {}, keyHeader }) {
  const spec = DARAZ_FILES[kind]
  const data = useMemo(() => {
    if (kind === 'keys') return keySheet && { columns: keySheet.columns, rows: keySheet.rows, used: new Set() }
    if (!check?.rows) return null
    if (kind === 'attr') {
      const isbn = check.rows.some(r => r.isbn)
      return { columns: ['Product ID', 'Brand', ...(isbn ? ['ISBN/ISSN'] : [])], used: new Set(spec.use),
        rows: check.rows.map(r => ({ 'Product ID': r.pid, Brand: r.brand, 'ISBN/ISSN': r.isbn })) }
    }
    return { columns: check.columns, rows: check.rows, used: new Set(spec.use.filter(c => check.columns.includes(c))) }
  }, [kind, check, keySheet])
  const problems = useMemo(() => data && kind !== 'keys' ? problemsFor(kind, data.rows) : [], [data])
  const errors = check?.issues?.filter(i => i.level === 'error') || []
  const name = file?.name || ''

  return (
    <div data-file-preview={kind} style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid #f1f5f9' }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'#1a202c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={name}>{name}</div>
        <div style={{ fontSize:11.5, color:'#64748b' }}>
          {kind === 'template' ? 'CartUp upload template — its dropdown lists (values are checked against these)'
            : kind === 'keys' ? `Image key file${keySheet ? ` · sheet "${keySheet.name}" · ${keySheet.rows.length.toLocaleString()} rows · ${keySheet.columns.length} columns` : ''}`
            : data ? [check.sheet && `sheet "${check.sheet}"`, `${data.rows.length.toLocaleString()} rows`, kind === 'attr' ? 'brand per product, as read from every category sheet' : `${data.columns.length} columns · ${data.used.size} used by the processing`].filter(Boolean).join(' · ')
            : ''}
        </div>
        {errors.map((e, i) => <div key={i} style={{ fontSize:11.5, color:'#b91c1c', marginTop:3, display:'flex', gap:5 }}><XCircle size={12} style={{ flexShrink:0, marginTop:2 }} /> {e.text}</div>)}
      </div>
      {kind === 'template' ? <TemplateLists file={file} />
        : checking || (!data && kind !== 'keys') ? (
          errors.length ? null : <div style={{ padding:16, color:'#64748b', fontSize:12.5, display:'flex', gap:6, alignItems:'center' }}><Loader size={13} style={{ animation:'spin 1s linear infinite' }} /> Reading the file…</div>
        ) : data && data.rows.length ? (
          <RowsTable key={`${kind}:${name}:${keySheet?.name || ''}`} columns={data.columns} rows={data.rows} used={data.used} marks={kind === 'keys' ? keyMarks : {}} problems={problems} header={kind === 'keys' && keyHeader ? keyHeader : c => c} />
        ) : <div style={{ padding:16, color:'#94a3b8', fontSize:12.5 }}>No rows</div>}
    </div>
  )
}
