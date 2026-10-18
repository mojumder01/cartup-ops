import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { reviewGroups, decisionKey, headerKey, colLabel, splitCombo, cellState } from '../utils/variantReview'
import { X, Search, Check, Plus, RotateCcw, ChevronRight, ChevronLeft, AlertTriangle, ImageOff, Download, Tag, ShieldOff } from 'lucide-react'

// Review window for Daraz Upload: values not on CartUp's lists, one product
// (Parent SKU) at a time, with each Seller SKU's image. A pick can cover one
// SKU, the product, or every SKU with that value (remembered for next time).

const STATE_STYLE = {
  open:       { background:'#fef2f2', color:'#b91c1c', border:'1px solid #fecaca' },
  auto:       { background:'#eef2ff', color:'#3730a3', border:'1px solid #e0e7ff' },
  remembered: { background:'#eef2ff', color:'#3730a3', border:'1px solid #e0e7ff' },
  picked:     { background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0' },
  kept:       { background:'#fffbeb', color:'#92400e', border:'1px solid #fde68a' },
  ok:         { background:'#fff', color:'#334155', border:'1px solid #e2e8f0' },
}
const STATE_NOTE = { open: 'not on list', auto: 'auto', remembered: 'remembered', picked: 'picked', kept: 'new value' }

function Thumb({ src, size = 40, onOpen }) {
  const [failed, setFailed] = useState(false)
  const ok = src && /^https?:\/\//.test(src) && !failed
  return (
    <div onClick={ok ? () => onOpen(src) : undefined} title={ok ? 'Click to enlarge' : 'No image'}
      style={{ width:size, height:size, borderRadius:6, border:'1px solid #e2e8f0', background:'#f8fafc', flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', cursor: ok ? 'zoom-in' : 'default' }}>
      {ok ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        : <ImageOff size={Math.round(size / 2.6)} color='#cbd5e1' />}
    </div>
  )
}

export default function VariantReview({ result, decisions, setDecisions, memory, onForgetMemory, onDownload, onClose }) {
  const groups = useMemo(() => reviewGroups(result, decisions, memory), [result, decisions, memory])
  const [filter, setFilter] = useState('attention')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => groups[0]?.parent)
  const [editing, setEditing] = useState(null)   // { sku, col }
  const [scope, setScope] = useState('all')
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(null)
  const [view, setView] = useState('products')   // 'products' | 'brands'
  const [big, setBig] = useState(false)          // larger variant images
  const [brandEdit, setBrandEdit] = useState(null)
  const [brandSearch, setBrandSearch] = useState('')

  // Brands from the attribute file that aren't on CartUp's list as written —
  // one row per brand, decided once for every product that has it.
  const brands = useMemo(() => {
    const m = new Map()
    for (const it of result.items) for (const c of it.cells) {
      if (c.col !== '**Brand' || c.source !== 'daraz' || !c.listed || (c.auto !== null && c.how === 'exact')) continue
      const k = c.raw.toLowerCase()
      if (!m.has(k)) m.set(k, { raw: c.raw, cell: c, item: it, products: new Set(), skus: 0 })
      const b = m.get(k)
      b.products.add(it.parent); b.skus++
    }
    return [...m.values()].sort((a, b) => b.skus - a.skus)
  }, [result])
  const brandList = result.lists?.[headerKey('**Brand')]
  const brandState = b => cellState(b.item, b.cell, decisions, memory, result.lists)
  const brandsOpen = brands.filter(b => brandState(b).state === 'open').length
  const decideBrand = (b, d) => setDecisions(prev => ({ ...prev, [decisionKey.all(b.cell)]: d }))
  const editedBrand = brands.find(b => b.raw === brandEdit)
  const brandSuggestions = useMemo(() => (editedBrand && brandList ? brandList.suggest(editedBrand.raw, 8) : []), [editedBrand, brandList])
  const brandResults = useMemo(() => (brandList && brandSearch.trim() ? brandList.search(brandSearch, 30) : []), [brandList, brandSearch])

  // How many SKUs share a value — in the product and everywhere.
  const counts = useMemo(() => {
    const all = new Map(), parent = new Map()
    for (const it of result.items) for (const c of it.cells) {
      const a = decisionKey.all(c), p = decisionKey.parent(it, c)
      all.set(a, (all.get(a) || 0) + 1); parent.set(p, (parent.get(p) || 0) + 1)
    }
    return { all, parent }
  }, [result])

  const needsAttention = g => g.open > 0 || g.dupes.length > 0
  const q = query.trim().toLowerCase()
  const shown = groups.filter(g => (filter === 'all' || needsAttention(g)) &&
    (!q || g.parent.toLowerCase().includes(q) || String(g.name).toLowerCase().includes(q) || g.skus.some(s => s.sku.toLowerCase().includes(q))))
  const group = groups.find(g => g.parent === selected) || shown[0] || groups[0]
  const openCells = groups.reduce((n, g) => n + g.open, 0)
  const openParents = groups.filter(g => g.open > 0).length
  const remembered = Object.keys(memory).length

  const row = editing && group?.skus.find(s => s.sku === editing.sku)
  const target = row?.cells[editing.col]
  const list = target && result.lists?.[headerKey(editing.col)]
  const suggestions = useMemo(() => (target && list ? list.suggest(target.cell.raw, 8) : []), [target?.cell, list])
  const results = useMemo(() => (list && search.trim() ? list.search(search, 30) : []), [list, search])

  useEffect(() => { setSearch('') }, [editing?.sku, editing?.col])
  useEffect(() => { if (group && group.parent !== selected) setSelected(group.parent) }, [group, selected])

  // Next undecided value after a given one, in file order (wrapping round),
  // read from the state after the latest pick.
  const order = useMemo(() => result.items.flatMap(it => it.cells.filter(c => c.listed).map(c => ({ parent: it.parent, sku: it.sku, col: c.col }))), [result])
  const stateOf = useMemo(() => {
    const m = new Map()
    for (const g of groups) for (const s of g.skus) for (const [c, v] of Object.entries(s.cells)) m.set(`${s.sku}|${c}`, v.state)
    return m
  }, [groups])
  const [advanceFrom, setAdvanceFrom] = useState({ start: true })
  useEffect(() => {
    if (!advanceFrom) return
    const i = order.findIndex(o => o.sku === advanceFrom.sku && o.col === advanceFrom.col)
    let next = null
    for (let k = 1; k <= order.length && !next; k++) {
      const o = order[(i + k + order.length) % order.length]
      if (stateOf.get(`${o.sku}|${o.col}`) === 'open') next = o
    }
    setAdvanceFrom(null)
    if (next) { setSelected(next.parent); setEditing({ sku: next.sku, col: next.col }) }
    else if (!advanceFrom.start) setEditing(null)
  }, [advanceFrom, stateOf, order])

  const keyFor = sc => sc === 'sku' ? decisionKey.sku(row.item, target.cell)
    : sc === 'parent' ? decisionKey.parent(row.item, target.cell) : decisionKey.all(target.cell)
  const decide = d => {
    setDecisions(prev => {
      const next = { ...prev }
      // A wider pick replaces narrower ones for this cell, so it takes effect here too.
      for (const sc of ['sku', 'parent', 'all']) {
        if (sc === scope) break
        delete next[keyFor(sc)]
      }
      next[keyFor(scope)] = d
      return next
    })
    setAdvanceFrom(editing)
  }
  const reset = () => setDecisions(prev => {
    const next = { ...prev }
    for (const sc of ['sku', 'parent', 'all']) delete next[keyFor(sc)]
    return next
  })
  const goNext = () => setAdvanceFrom(editing)
  const pickParent = p => { setSelected(p); setEditing(null) }
  const stepParent = d => {
    const i = shown.findIndex(g => g.parent === group?.parent)
    const g = shown[i + d]
    if (g) pickParent(g.parent)
  }

  const btn = { display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer', border:'1.5px solid #e2e8f0', background:'#fff', color:'#334155' }
  const chip = { padding:'5px 10px', borderRadius:16, fontSize:12, cursor:'pointer', border:'1px solid #c7d2fe', background:'#eef2ff', color:'#3730a3' }

  // Rendered into <body>: the page's entry animation leaves a transform on its
  // container, which would otherwise confine a fixed overlay to the content area.
  return createPortal(
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'min(1240px, 100%)', height:'min(860px, 100%)', background:'#fff', borderRadius:14, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(15,23,42,0.3)' }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', borderBottom:'1px solid #e2e8f0' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>Match values to CartUp's lists — product by product</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
              {openCells
                ? <>{openCells.toLocaleString()} values in {openParents.toLocaleString()} products are not on CartUp's lists — pick a match, or keep the seller's value as a new list value.</>
                : <span style={{ color:'#15803d' }}>Every value is matched or decided.</span>}
            </div>
          </div>
          {brands.length > 0 && (
            <div style={{ display:'flex', gap:3, background:'#f1f5f9', borderRadius:8, padding:3 }}>
              {[['products', 'Products'], ['brands', `Brands (${brands.length}${brandsOpen ? ` · ${brandsOpen} open` : ''})`]].map(([k, label]) => (
                <button key={k} onClick={() => setView(k)} style={{ padding:'5px 12px', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
                  background: view === k ? '#fff' : 'transparent', color: view === k ? '#4f46e5' : '#64748b' }}>{label}</button>
              ))}
            </div>
          )}
          <button onClick={onClose} title="Close" style={{ ...btn, padding:7 }}><X size={15} /></button>
        </div>

        {view === 'brands' ? (
          <div style={{ flex:1, overflow:'auto', padding:18 }}>
            <div style={{ fontSize:12.5, color:'#475569', marginBottom:10 }}>
              Brands from the attribute file that aren't on CartUp's Brand list. For each: use <b>No Brand</b>, keep it as a <b>new brand</b> for CartUp to add, or pick the right one from the list. Applies to every product with that brand, and is remembered.
            </div>
            <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                <thead>
                  <tr style={{ background:'#f8fafc' }}>
                    {['Seller\'s brand', 'Products', 'SKUs', 'Now', ''].map((h, i) => <th key={i} style={{ textAlign:'left', padding:'8px 10px', color:'#64748b', fontWeight:600, borderBottom:'1px solid #e2e8f0' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {brands.map(b => {
                    const st = brandState(b)
                    return (
                      <tr key={b.raw} style={{ borderBottom:'1px solid #f1f5f9', background: brandEdit === b.raw ? '#fafaff' : '#fff' }}>
                        <td style={{ padding:'8px 10px', fontWeight:600 }}>{b.raw}</td>
                        <td style={{ padding:'8px 10px' }}>{b.products.size}</td>
                        <td style={{ padding:'8px 10px' }}>{b.skus}</td>
                        <td style={{ padding:'6px 10px' }}>
                          <span style={{ ...STATE_STYLE[st.state] || STATE_STYLE.ok, borderRadius:7, padding:'3px 8px', display:'inline-block' }}>
                            {st.value || '—'} <span style={{ fontSize:10.5, opacity:0.8 }}>{STATE_NOTE[st.state] || ''}</span>
                          </span>
                        </td>
                        <td style={{ padding:'6px 10px' }}>
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
                            <button onClick={() => decideBrand(b, { value: brandList?.match('No Brand')?.value || 'No Brand' })} style={{ ...btn, padding:'4px 9px', fontSize:11.5 }}><ShieldOff size={12} /> No Brand</button>
                            <button onClick={() => decideBrand(b, { keep: true })} style={{ ...btn, padding:'4px 9px', fontSize:11.5, borderColor:'#fde68a', color:'#92400e' }}><Plus size={12} /> Keep as new brand</button>
                            <button onClick={() => { setBrandEdit(brandEdit === b.raw ? null : b.raw); setBrandSearch('') }} style={{ ...btn, padding:'4px 9px', fontSize:11.5 }}><Tag size={12} /> Pick…</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {editedBrand && (
              <div style={{ marginTop:14, border:'1.5px solid #c7d2fe', borderRadius:10, padding:14, background:'#fafaff' }}>
                <div style={{ fontSize:13, marginBottom:8 }}>Pick CartUp's brand for <b>"{editedBrand.raw}"</b></div>
                {brandSuggestions.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                    {brandSuggestions.map(sg => <button key={sg} onClick={() => { decideBrand(editedBrand, { value: sg }); setBrandEdit(null) }} style={chip}>{sg}</button>)}
                  </div>
                )}
                <div style={{ position:'relative', maxWidth:360 }}>
                  <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:9 }} />
                  <input value={brandSearch} onChange={e => setBrandSearch(e.target.value)} placeholder={`Search the ${brandList?.size?.toLocaleString() || ''} brands…`} autoFocus
                    style={{ width:'100%', padding:'7px 10px 7px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, boxSizing:'border-box' }} />
                </div>
                {brandResults.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8, maxHeight:110, overflow:'auto' }}>
                    {brandResults.map(r => <button key={r} onClick={() => { decideBrand(editedBrand, { value: r }); setBrandEdit(null) }} style={{ ...chip, background:'#fff' }}>{r}</button>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
        <div style={{ flex:1, display:'flex', minHeight:0 }}>
          {/* Products */}
          <div style={{ width:300, borderRight:'1px solid #e2e8f0', display:'flex', flexDirection:'column', minHeight:0 }}>
            <div style={{ padding:10, borderBottom:'1px solid #f1f5f9' }}>
              <div style={{ display:'flex', gap:3, background:'#f1f5f9', borderRadius:8, padding:3, marginBottom:8 }}>
                {[['attention', `Needs attention (${groups.filter(needsAttention).length})`], ['all', `All (${groups.length})`]].map(([k, label]) => (
                  <button key={k} onClick={() => setFilter(k)} style={{ flex:1, padding:'5px 6px', border:'none', borderRadius:6, fontSize:11.5, fontWeight:600, cursor:'pointer',
                    background: filter === k ? '#fff' : 'transparent', color: filter === k ? '#4f46e5' : '#64748b' }}>{label}</button>
                ))}
              </div>
              <div style={{ position:'relative' }}>
                <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:9 }} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Parent / Seller SKU or name"
                  style={{ width:'100%', padding:'7px 10px 7px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, boxSizing:'border-box' }} />
              </div>
            </div>
            <div style={{ flex:1, overflow:'auto' }}>
              {shown.map(g => (
                <div key={g.parent} onClick={() => pickParent(g.parent)}
                  style={{ display:'flex', gap:9, padding:'9px 10px', cursor:'pointer', borderBottom:'1px solid #f1f5f9', background: g.parent === group?.parent ? '#eef2ff' : 'transparent' }}>
                  <Thumb src={g.skus[0]?.item.productImage} size={36} onOpen={setZoom} />
                  <div style={{ minWidth:0, flex:1 }}>
                    <div style={{ fontSize:12.5, fontWeight:600, color:'#1a202c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.name || '(no name)'}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', fontFamily:'monospace' }}>{g.parent} · {g.skus.length} SKU{g.skus.length > 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                    {g.open > 0 && <span style={{ fontSize:10.5, fontWeight:700, color:'#b91c1c', background:'#fee2e2', borderRadius:10, padding:'1px 7px' }}>{g.open} open</span>}
                    {g.dupes.length > 0 && <span style={{ fontSize:10.5, fontWeight:700, color:'#92400e', background:'#fef3c7', borderRadius:10, padding:'1px 7px' }}>same variant</span>}
                    {!needsAttention(g) && <Check size={14} color='#16a34a' />}
                  </div>
                </div>
              ))}
              {!shown.length && <div style={{ padding:16, fontSize:12.5, color:'#64748b' }}>{filter === 'attention' ? 'Nothing needs attention.' : 'No products match.'}</div>}
            </div>
          </div>

          {/* Selected product */}
          <div style={{ flex:1, overflow:'auto', padding:18, minWidth:0 }}>
            {group && <>
              <div style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:12 }}>
                <Thumb src={group.skus[0]?.item.productImage} size={64} onOpen={setZoom} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14.5 }}>{group.name}</div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>Parent SKU <span style={{ fontFamily:'monospace' }}>{group.parent}</span>{group.category ? ` · ${group.category}` : ''}</div>
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#475569', cursor:'pointer', marginRight:6 }}>
                    <input type="checkbox" checked={big} onChange={e => setBig(e.target.checked)} style={{ accentColor:'#4f46e5' }} /> Large images
                  </label>
                  <button onClick={() => stepParent(-1)} style={{ ...btn, padding:7 }} title="Previous product"><ChevronLeft size={15} /></button>
                  <button onClick={() => stepParent(1)} style={{ ...btn, padding:7 }} title="Next product"><ChevronRight size={15} /></button>
                </div>
              </div>

              {group.skus[0]?.item.images?.length > 1 && (
                <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
                  {group.skus[0].item.images.map((src, i) => <Thumb key={i} src={src} size={big ? 72 : 40} onOpen={setZoom} />)}
                </div>
              )}

              {group.dupes.map(d => (
                <div key={d.join()} style={{ display:'flex', gap:6, alignItems:'center', fontSize:12, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'7px 10px', marginBottom:8 }}>
                  <AlertTriangle size={13} /> {d.join(', ')} have the same variant values — CartUp needs them different. Click a value to change it.
                </div>
              ))}

              <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                  <thead>
                    <tr style={{ background:'#f8fafc' }}>
                      {['', 'Seller SKU', 'Variations Combo', ...group.cols.map(colLabel)].map((h, i) => (
                        <th key={i} style={{ textAlign:'left', padding:'8px 10px', color:'#64748b', fontWeight:600, borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.skus.map(s => (
                      <tr key={s.sku} style={{ borderBottom:'1px solid #f1f5f9' }}>
                        <td style={{ padding:'6px 10px', width: big ? 110 : 44 }}><Thumb src={s.item.image} size={big ? 110 : 44} onOpen={setZoom} /></td>
                        <td style={{ padding:'6px 10px', fontFamily:'monospace', fontSize:12 }}>{s.sku}</td>
                        <td style={{ padding:'6px 10px', color:'#64748b' }}>{splitCombo(s.combo).join(' · ') || '—'}</td>
                        {group.cols.map(c => {
                          const v = s.cells[c]
                          if (!v) return <td key={c} style={{ padding:'6px 10px', color:'#cbd5e1' }}>—</td>
                          const active = editing?.sku === s.sku && editing?.col === c
                          return (
                            <td key={c} style={{ padding:'5px 8px' }}>
                              <div onClick={() => { setEditing({ sku: s.sku, col: c }); setScope('all') }}
                                title={v.conflict || v.note || ''}
                                style={{ ...STATE_STYLE[v.state] || STATE_STYLE.ok, borderRadius:7, padding:'5px 8px', cursor:'pointer', minWidth:130, maxWidth:260,
                                  outline: active ? '2px solid #4f46e5' : 'none', outlineOffset:1 }}>
                                <div style={{ fontWeight:600 }}>{v.value}</div>
                                {(v.state !== 'ok' || v.value !== v.cell.raw) && (
                                  <div style={{ fontSize:10.5, opacity:0.8 }}>
                                    {STATE_NOTE[v.state]}{v.value !== v.cell.raw ? ` · was ${v.cell.raw}` : ''}
                                  </div>
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Editor */}
              {target && (
                <div style={{ marginTop:14, border:'1.5px solid #c7d2fe', borderRadius:10, padding:14, background:'#fafaff' }}>
                  <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:10 }}>
                    <Thumb src={row.item.image} size={56} onOpen={setZoom} />
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13 }}><b>{colLabel(editing.col)}</b> for <span style={{ fontFamily:'monospace' }}>{row.sku}</span></div>
                      <div style={{ fontSize:12, color:'#475569', marginTop:2 }}>
                        Seller wrote <b>"{target.cell.raw}"</b>{target.value !== target.cell.raw && <> · now <b style={{ color:'#4338ca' }}>{target.value}</b></>}
                        {target.conflict && <div style={{ color:'#b45309' }}>Auto-match undone: {target.conflict}</div>}
                      </div>
                    </div>
                    <button onClick={() => setEditing(null)} style={{ ...btn, padding:6 }} title="Close"><X size={13} /></button>
                  </div>

                  <div style={{ display:'flex', gap:14, flexWrap:'wrap', fontSize:12, color:'#334155', marginBottom:10 }}>
                    <span style={{ fontWeight:600 }}>Apply to:</span>
                    {[['sku', 'this SKU only'],
                      ['parent', `this product (${counts.parent.get(decisionKey.parent(row.item, target.cell)) || 1} SKU)`],
                      ['all', `every SKU with "${target.cell.raw}" (${counts.all.get(decisionKey.all(target.cell)) || 1}) — remembered`]].map(([k, label]) => (
                      <label key={k} style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
                        <input type="radio" checked={scope === k} onChange={() => setScope(k)} style={{ accentColor:'#4f46e5' }} /> {label}
                      </label>
                    ))}
                  </div>

                  {suggestions.length > 0 && (
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:11.5, color:'#64748b', marginBottom:5 }}>Closest on CartUp's {colLabel(editing.col)} list</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {suggestions.map(sg => <button key={sg} onClick={() => decide({ value: sg })} style={chip}>{sg}</button>)}
                      </div>
                    </div>
                  )}

                  <div style={{ position:'relative', marginBottom:8, maxWidth:360 }}>
                    <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:9 }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search the ${list?.size?.toLocaleString() || ''} ${colLabel(editing.col)} values…`}
                      style={{ width:'100%', padding:'7px 10px 7px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, boxSizing:'border-box' }} />
                  </div>
                  {results.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, maxHeight:110, overflow:'auto', marginBottom:10 }}>
                      {results.map(r => <button key={r} onClick={() => decide({ value: r })} style={{ ...chip, background:'#fff' }}>{r}</button>)}
                    </div>
                  )}
                  {search.trim() && !results.length && <div style={{ fontSize:12, color:'#94a3b8', marginBottom:10 }}>Nothing on the list contains "{search}".</div>}

                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button onClick={() => decide({ keep: true })} style={{ ...btn, borderColor:'#fde68a', color:'#92400e' }}>
                      <Plus size={13} /> Keep "{target.cell.raw}" as a new value for CartUp's list
                    </button>
                    {editing.col === 'Warranty Period' && (
                      <button onClick={() => decide({ noWarranty: true })} style={btn}><ShieldOff size={13} /> Set No Warranty (clears the period)</button>
                    )}
                    <button onClick={reset} style={btn}><RotateCcw size={13} /> Back to automatic</button>
                    <button onClick={goNext} style={btn}>Skip <ChevronRight size={13} /></button>
                  </div>
                </div>
              )}
              {!target && group.open > 0 && (
                <div style={{ marginTop:12, fontSize:12, color:'#64748b' }}>Click a red value to match it.</div>
              )}
            </>}
          </div>
        </div>

        )}

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 18px', borderTop:'1px solid #e2e8f0', background:'#f8fafc', flexWrap:'wrap' }}>
          <div style={{ flex:1, fontSize:12, color:'#64748b', minWidth:240 }}>
            {openCells > 0 && <>Values left open go to the <b>new values</b> sheet as "not reviewed" (they show #N/A until matched or added). </>}
            {remembered > 0 && <>{remembered.toLocaleString()} remembered picks · <button onClick={onForgetMemory} style={{ border:'none', background:'none', color:'#4f46e5', cursor:'pointer', padding:0, fontSize:12 }}>forget them</button></>}
          </div>
          <button onClick={onClose} style={btn}>Close</button>
          <button onClick={onDownload} style={{ ...btn, background:'#4f46e5', borderColor:'#4f46e5', color:'#fff' }}><Download size={14} /> Download file</button>
        </div>
      </div>

      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.75)', zIndex:110, display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out', padding:24 }}>
          <img src={zoom} alt="" style={{ maxWidth:'90vw', maxHeight:'88vh', borderRadius:10, background:'#fff' }} />
        </div>
      )}
    </div>,
    document.body,
  )
}
