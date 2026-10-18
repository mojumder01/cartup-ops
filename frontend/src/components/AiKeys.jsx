import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_MODELS, loadKeys, saveKeys, loadSettings, saveSettings, setRemember, knownModels, modelInfo,
  poolSummary, onAiChange, unavailableModels, clearKeyStatus, testKey, listModels, applyModelList, usableKeys,
  parseKeyFile, keyFileText, maskKey,
} from '../utils/aiPool'
import {
  KeyRound, Upload, Download, Plus, Trash2, ArrowUp, ArrowDown, CheckCircle, XCircle, AlertTriangle,
  Loader, Cpu, RotateCcw, Eye, EyeOff, Search, Settings2,
} from 'lucide-react'

const fmt = n => Number(n).toLocaleString('en-US')
const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// Gemini API keys and models (see aiPool.js): several keys, each with its own
// limit per model; ticked keys are used in turn, the main model first and the
// other ticked models when it is full. Keys import from / export to a .txt
// file, one key per line.
export default function AiKeys() {
  const [, redraw] = useState(0)
  const [show, setShow] = useState(false)
  const [tests, setTests] = useState({})
  const [paste, setPaste] = useState('')
  const [newModel, setNewModel] = useState('')
  const [editLimits, setEditLimits] = useState(false)
  const [available, setAvailable] = useState(null)   // model → true/false, from "Check models"
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => onAiChange(() => redraw(n => n + 1)), [])
  // Cool-downs run out on their own — refresh the badges.
  useEffect(() => { const t = setInterval(() => redraw(n => n + 1), 15000); return () => clearInterval(t) }, [])

  const settings = loadSettings()
  const sum = poolSummary()
  const keys = loadKeys()
  const dead = unavailableModels()
  const models = knownModels(settings)
  const inUse = settings.models
  const say = (text, bad) => setNote({ text, bad })

  // ── Keys ──
  const addKeys = (text, source) => {
    const { keys: found, skipped } = parseKeyFile(text)
    const fresh = found.filter(k => !keys.some(x => x.key === k))
    saveKeys([...keys, ...fresh.map(key => ({ key, on: true }))])
    say(`${fresh.length ? `Added ${fresh.length} key${fresh.length > 1 ? 's' : ''}` : 'No new keys'} from ${source}`
      + (found.length - fresh.length ? ` · ${found.length - fresh.length} already here` : '')
      + (skipped ? ` · ${skipped} line${skipped > 1 ? 's' : ''} skipped (not a Gemini key)` : ''), !fresh.length)
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([keyFileText(keys)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'gemini-keys.txt'; a.click()
    URL.revokeObjectURL(url)
  }
  const tickAll = on => saveKeys(keys.map(k => ({ ...k, on })))
  const removeTicked = () => {
    const n = keys.filter(k => k.on).length
    if (n && window.confirm(`Remove the ${n} ticked key${n > 1 ? 's' : ''}?`)) saveKeys(keys.filter(k => !k.on))
  }
  const clearAll = () => { if (window.confirm('Remove every key from this browser?')) saveKeys([]) }
  const runTest = async key => {
    setTests(t => ({ ...t, [key]: { result: 'testing' } }))
    const r = await testKey(key)
    setTests(t => ({ ...t, [key]: r }))
  }

  // ── Models ──
  const setModels = list => saveSettings({ models: list })
  const setMain = id => setModels([id, ...inUse.filter(m => m !== id)])
  const toggleModel = id => setModels(inUse.includes(id) ? inUse.filter(m => m !== id) : [...inUse, id])
  const move = (i, d) => { const a = [...inUse]; [a[i], a[i + d]] = [a[i + d], a[i]]; setModels(a) }
  const setLimit = (id, field, value) => {
    const n = Math.max(1, Math.round(Number(value) || 1))
    saveSettings({ limits: { ...settings.limits, [id]: { ...settings.limits[id], [field]: n } } })
  }
  const addModel = () => {
    const id = newModel.trim().replace(/^models\//, '')
    if (!id) return
    setModels([...inUse, id]); setNewModel('')
  }
  const checkModels = async () => {
    const key = usableKeys()[0]
    if (!key) return say('Tick a key first', true)
    setChecking(true)
    try {
      const names = await listModels(key)
      setAvailable(applyModelList(names, models.map(m => m.id)))
      say(`Key ${maskKey(key)} can use ${names.filter(n => /gemini/.test(n)).length} Gemini models`)
    } catch (e) { say(`Could not list models: ${e.message}`, true) }
    setChecking(false)
  }

  const badge = k => {
    const t = tests[k.key]
    const row = (color, Icon, text, spin) => (
      <span style={{ color, display:'inline-flex', alignItems:'center', gap:4 }}>
        <Icon size={11} style={spin ? { animation:'spin 1s linear infinite' } : undefined} /> {text}
      </span>
    )
    if (t?.result === 'testing') return row('#64748b', Loader, 'testing', true)
    if (k.state === 'invalid' || t?.result === 'invalid') return row('#dc2626', XCircle, 'invalid key')
    if (k.state === 'day') return row('#d97706', AlertTriangle, `today's limit used · back ${time(sum.reset)}`)
    if (k.state === 'minute') return row('#d97706', AlertTriangle, `resting · back ${time(k.until)}`)
    if (k.full) return row('#d97706', AlertTriangle, `${k.full} of ${sum.models.length} models used up today`)
    if (t?.result === 'rate_limited') return row('#d97706', AlertTriangle, 'rate limited')
    if (t?.result === 'fail') return <span title={t.message}>{row('#dc2626', XCircle, 'failed')}</span>
    if (t?.result === 'ok') return <span title={`Answered with ${t.model}`}>{row('#16a34a', CheckCircle, 'works')}</span>
    return row('#16a34a', CheckCircle, 'ready')
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:28, marginBottom:20 }
  const small = { display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12, fontWeight:600, color:'#374151', cursor:'pointer' }
  const link = { background:'none', border:'none', padding:'2px 4px', fontSize:12, fontWeight:600, color:'#4f46e5', cursor:'pointer' }
  const icon = { background:'none', border:'none', padding:3, cursor:'pointer', color:'#94a3b8', display:'flex' }
  const heading = { display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.4px', margin:'0 0 8px' }
  const num = { width:52, padding:'2px 4px', border:'1px solid #cbd5e1', borderRadius:5, fontSize:12, textAlign:'right' }
  const mainInfo = modelInfo(inUse[0], settings)

  return (
    <div style={card}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <div style={{ width:36, height:36, borderRadius:8, background: sum.ticked ? '#dcfce7' : '#fef3c7', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <KeyRound size={18} color={sum.ticked ? '#16a34a' : '#d97706'} />
        </div>
        <div>
          <div style={{ fontWeight:600, fontSize:15, color:'#1a202c' }}>Gemini API — keys &amp; models</div>
          <div style={{ fontSize:12, color:'#718096' }}>Every key has its own limit per model. Requests go to the next ticked key with room; when the main model is full, the next ticked model takes over.</div>
        </div>
      </div>

      {/* Today */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:8, marginBottom:18 }}>
        {[
          ['Keys in use', `${sum.ticked} of ${keys.length}`, sum.ticked ? '#1a202c' : '#d97706'],
          ['Used today', `${fmt(sum.used)} / ${fmt(sum.cap)}`, '#1a202c'],
          ['Left today', fmt(sum.left), sum.left ? '#15803d' : '#dc2626'],
          ['Speed', `≈ ${fmt(sum.perMinute)}/min`, '#1a202c'],
          ['Limits reset', time(sum.reset), '#1a202c'],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background:'#f8fafc', borderRadius:8, padding:'8px 10px' }}>
            <div style={{ fontSize:10.5, fontWeight:600, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
            <div style={{ fontSize:14, fontWeight:700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Models */}
      <div style={heading}><Cpu size={13} /> Models</div>
      <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'#374151', marginBottom:8, flexWrap:'wrap' }}>
        Main model
        <select aria-label="Main model" value={inUse[0]} onChange={e => setMain(e.target.value)}
          style={{ flex:1, minWidth:220, padding:'7px 10px', border:'1.5px solid #c7d2fe', borderRadius:7, fontSize:13, background:'#fff' }}>
          {models.map(m => <option key={m.id} value={m.id}>{m.label} — {m.rpm}/min · {fmt(m.rpd)}/day</option>)}
        </select>
      </label>
      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', marginBottom:8 }}>
        <div style={{ display:'grid', gridTemplateColumns:'26px 1fr 64px 70px 92px 54px', gap:6, padding:'6px 10px', background:'#f8fafc', fontSize:10.5, fontWeight:700, color:'#94a3b8', textTransform:'uppercase' }}>
          <span title="Tick = use">Use</span><span>Model</span><span style={{ textAlign:'right' }}>Per min</span><span style={{ textAlign:'right' }}>Per day</span><span>Status</span><span />
        </div>
        {[...inUse.map(id => modelInfo(id, settings)), ...models.filter(m => !inUse.includes(m.id))].map(m => {
          const pos = inUse.indexOf(m.id)
          const status = dead.has(m.id) || available?.[m.id] === false
            ? <span style={{ color:'#dc2626' }}>not available</span>
            : pos === 0 ? <span style={{ color:'#4f46e5', fontWeight:700 }}>main</span>
            : pos > 0 ? <span style={{ color:'#475569' }}>backup {pos}</span>
            : <span style={{ color:'#cbd5e1' }}>off</span>
          return (
            <div key={m.id} style={{ display:'grid', gridTemplateColumns:'26px 1fr 64px 70px 92px 54px', gap:6, alignItems:'center', padding:'5px 10px', borderTop:'1px solid #f1f5f9', fontSize:12.5, background: pos === 0 ? '#eef2ff' : '#fff' }}>
              <input type="checkbox" checked={pos >= 0} disabled={pos === 0} onChange={() => toggleModel(m.id)} aria-label={`Use ${m.label}`} />
              <span title={m.id + (settings.aliases[m.id] ? ` (sent as ${settings.aliases[m.id]})` : '')} style={{ color: pos >= 0 ? '#1a202c' : '#94a3b8' }}>
                {m.label}{available?.[m.id] && <CheckCircle size={11} color="#16a34a" style={{ marginLeft:5, verticalAlign:'-1px' }} />}
              </span>
              {editLimits ? <input type="number" min={1} value={m.rpm} onChange={e => setLimit(m.id, 'rpm', e.target.value)} style={num} aria-label={`${m.label} per minute`} />
                : <span style={{ textAlign:'right', color:'#475569' }}>{m.rpm}</span>}
              {editLimits ? <input type="number" min={1} value={m.rpd} onChange={e => setLimit(m.id, 'rpd', e.target.value)} style={num} aria-label={`${m.label} per day`} />
                : <span style={{ textAlign:'right', color:'#475569' }}>{fmt(m.rpd)}</span>}
              <span style={{ fontSize:11.5 }}>{status}</span>
              <span style={{ display:'flex' }}>
                {pos > 1 && <button onClick={() => move(pos, -1)} title="Use earlier" style={icon}><ArrowUp size={12} /></button>}
                {pos > 0 && pos < inUse.length - 1 && <button onClick={() => move(pos, 1)} title="Use later" style={icon}><ArrowDown size={12} /></button>}
              </span>
            </div>
          )
        })}
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:20 }}>
        <button onClick={() => setEditLimits(e => !e)} style={small}><Settings2 size={13} /> {editLimits ? 'Done' : 'Edit limits'}</button>
        <button onClick={checkModels} disabled={checking} style={small}>
          {checking ? <Loader size={13} style={{ animation:'spin 1s linear infinite' }} /> : <Search size={13} />} Check models for my key
        </button>
        <button onClick={() => saveSettings({ models: DEFAULT_MODELS, limits: {} })} style={small}><RotateCcw size={13} /> Defaults</button>
        <input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="Other model name, e.g. gemini-2.0-flash"
          onKeyDown={e => { if (e.key === 'Enter') addModel() }}
          style={{ flex:1, minWidth:170, padding:'6px 10px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12, fontFamily:'monospace' }} />
        <button disabled={!newModel.trim()} onClick={addModel} style={small}><Plus size={13} /> Add</button>
      </div>

      {/* Keys */}
      <div style={heading}><KeyRound size={13} /> API keys</div>
      <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center', fontSize:12, color:'#64748b', marginBottom:6 }}>
        <span>Tick = use here</span>
        <button onClick={() => tickAll(true)} style={link}>All</button>
        <button onClick={() => tickAll(false)} style={link}>None</button>
        <button onClick={removeTicked} style={{ ...link, color:'#dc2626' }}>Remove ticked</button>
        <span style={{ flex:1 }} />
        <button onClick={() => setShow(s => !s)} style={small}>{show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? 'Hide' : 'Show'}</button>
        <button onClick={() => fileRef.current?.click()} style={small}><Upload size={13} /> Import</button>
        <button onClick={exportFile} disabled={!keys.length} style={small}><Download size={13} /> Export</button>
        <button onClick={clearAll} disabled={!keys.length} style={{ ...small, color:'#dc2626' }}><Trash2 size={13} /> Clear</button>
        <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display:'none' }}
          onChange={async e => { const f = e.target.files[0]; e.target.value = ''; if (f) addKeys(await f.text(), f.name) }} />
      </div>
      {keys.length ? (
        <div style={{ border:'1px solid #e2e8f0', borderRadius:8, marginBottom:10, maxHeight:360, overflowY:'auto' }}>
          {sum.keys.map((k, i) => {
            const pct = k.cap ? Math.min(100, Math.round(k.used / k.cap * 100)) : 0
            return (
              <div key={k.key} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderBottom: i < keys.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize:12.5, opacity: k.on ? 1 : 0.55, flexWrap:'wrap' }}>
                <input type="checkbox" checked={k.on} aria-label={`Use key ${k.n}`}
                  onChange={() => saveKeys(keys.map(x => x.key === k.key ? { ...x, on: !x.on } : x))} />
                <span style={{ fontWeight:600, color:'#475569', width:44 }}>Key {k.n}</span>
                <span style={{ fontFamily:'monospace', flex:1, minWidth:90, wordBreak:'break-all' }}>{show ? k.key : maskKey(k.key)}</span>
                <span title={`${fmt(k.used)} requests today of ${fmt(k.cap)} (all ticked models)`} style={{ display:'flex', alignItems:'center', gap:6, width:120 }}>
                  <span style={{ flex:1, height:5, background:'#f1f5f9', borderRadius:3, overflow:'hidden' }}>
                    <span style={{ display:'block', height:'100%', width:`${pct}%`, background: pct >= 100 ? '#dc2626' : pct > 80 ? '#d97706' : '#22c55e' }} />
                  </span>
                  <span style={{ fontSize:11.5, color:'#475569', fontVariantNumeric:'tabular-nums' }}>{fmt(k.used)}/{fmt(k.cap)}</span>
                </span>
                <span style={{ fontSize:11.5, minWidth:120 }}>{badge(k)}</span>
                <button onClick={() => runTest(k.key)} style={{ ...small, padding:'2px 8px', fontSize:11 }}>Test</button>
                {k.state !== 'ready' && <button onClick={() => clearKeyStatus(k.key)} title="Use it again now" style={icon}><RotateCcw size={13} /></button>}
                <button onClick={() => saveKeys(keys.filter(x => x.key !== k.key))} title="Remove" style={{ ...icon, color:'#dc2626' }}><Trash2 size={13} /></button>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ fontSize:12.5, color:'#92400e', background:'#fef3c7', borderRadius:8, padding:'9px 12px', marginBottom:10 }}>
          No Gemini key yet — AI features are off until you add one.
        </div>
      )}
      {keys.length > 0 && !sum.ticked && (
        <div style={{ fontSize:12.5, color:'#92400e', background:'#fef3c7', borderRadius:8, padding:'8px 12px', marginBottom:10 }}>No key is ticked — AI features are off. Tick the keys to use here.</div>
      )}

      <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2} aria-label="Paste keys"
        placeholder="Paste one or more Gemini keys — one per line (AIza…, AQ.…, any format)"
        style={{ width:'100%', padding:'8px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, fontFamily:'monospace', boxSizing:'border-box', resize:'vertical' }} />
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6, alignItems:'center' }}>
        <button disabled={!paste.trim()} onClick={() => { addKeys(paste, 'the box'); setPaste('') }}
          style={{ ...small, background: paste.trim() ? '#4f46e5' : '#a5b4fc', borderColor:'transparent', color:'#fff', cursor: paste.trim() ? 'pointer' : 'not-allowed' }}>
          <Plus size={13} /> Add keys
        </button>
        {note && <span style={{ fontSize:12, color: note.bad ? '#b45309' : '#15803d' }}>{note.text}</span>}
      </div>

      {/* Settings */}
      <div style={{ display:'flex', gap:18, flexWrap:'wrap', alignItems:'center', marginTop:16, paddingTop:12, borderTop:'1px solid #f1f5f9', fontSize:12.5, color:'#374151' }}>
        <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
          <input type="checkbox" checked={settings.remember} onChange={e => setRemember(e.target.checked)} />
          Remember keys in this browser
        </label>
        <label style={{ display:'flex', alignItems:'center', gap:6 }}>
          Pause between requests
          <input type="number" min={0} max={30} step={0.5} value={settings.delaySec} aria-label="Pause between requests (seconds)"
            onChange={e => saveSettings({ delaySec: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })}
            style={{ ...num, width:56 }} /> seconds
        </label>
      </div>
      <div style={{ fontSize:11, color:'#94a3b8', marginTop:8, lineHeight:1.5 }}>
        {settings.remember ? 'Keys are saved in this browser only, never on our server.' : 'Keys are kept only until this browser window closes.'}
        {' '}Daily limits reset at midnight Pacific time ({time(sum.reset)} here). With {mainInfo.label} each key does about {mainInfo.rpm} requests a minute.
        {' '}.txt file: one key per line; lines starting with # are ignored. Get keys at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color:'#6366f1' }}>aistudio.google.com</a>.
      </div>
    </div>
  )
}
