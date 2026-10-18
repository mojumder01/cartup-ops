import { useEffect, useRef, useState } from 'react'
import {
  PROVIDERS, PROVIDER_LABEL, DEFAULT_MODELS, loadKeys, saveKeys, loadModels, saveModels,
  keyStatus, clearKeyStatus, testKey, parseKeyFile, keyFileText, maskKey,
} from '../utils/aiPool'
import { KeyRound, Upload, Download, Plus, Trash2, ArrowUp, ArrowDown, CheckCircle, XCircle, AlertTriangle, Loader, Cpu, RotateCcw } from 'lucide-react'

// API keys and models for every AI provider — several of each, used in turn
// (see aiPool.js). Keys can be imported from / exported to a .txt file, one
// key per line.
export default function AiKeys({ provider, onChange }) {
  const [tab, setTab] = useState(provider)
  const [keys, setKeys] = useState(loadKeys)
  const [models, setModels] = useState(loadModels)
  const [status, setStatus] = useState(keyStatus)
  const [tests, setTests] = useState({})
  const [paste, setPaste] = useState('')
  const [newModel, setNewModel] = useState('')
  const [note, setNote] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { setTab(provider) }, [provider])
  // Cool-downs run out on their own — refresh the badges.
  useEffect(() => {
    const t = setInterval(() => setStatus(keyStatus()), 15000)
    return () => clearInterval(t)
  }, [])

  const updateKeys = next => { const saved = saveKeys(next); setKeys(saved); onChange?.(saved) }
  const updateModels = next => setModels(saveModels(next))
  const list = keys[tab]
  const move = (arr, i, d) => { const a = [...arr]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a }

  const addKeys = (found, source) => {
    const next = { ...keys }
    let added = 0
    for (const p of PROVIDERS) {
      const fresh = found[p].filter(k => !next[p].includes(k))
      next[p] = [...next[p], ...fresh]
      added += fresh.length
    }
    updateKeys(next)
    const where = PROVIDERS.filter(p => found[p].length).map(p => `${PROVIDER_LABEL[p]} ${found[p].length}`).join(', ')
    setNote(added ? `Added ${added} key${added > 1 ? 's' : ''} from ${source}${where ? ` (${where})` : ''}` : `No new keys in ${source}`)
  }
  const importFile = async f => addKeys(parseKeyFile(await f.text(), tab), f.name)
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([keyFileText(keys)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'cartup-ai-keys.txt'; a.click()
    URL.revokeObjectURL(url)
  }
  const runTest = async k => {
    setTests(t => ({ ...t, [k]: 'testing' }))
    const r = await testKey(tab, k)
    setTests(t => ({ ...t, [k]: r }))
    setStatus(keyStatus())
  }

  const badge = k => {
    const t = tests[k], s = status[k]
    if (t === 'testing') return <span style={{ color:'#64748b', display:'flex', alignItems:'center', gap:4 }}><Loader size={11} style={{ animation:'spin 1s linear infinite' }} /> testing</span>
    if (t === 'ok') return <span style={{ color:'#16a34a', display:'flex', alignItems:'center', gap:4 }}><CheckCircle size={11} /> works</span>
    if (t === 'invalid' || s?.reason === 'invalid') return <span style={{ color:'#dc2626', display:'flex', alignItems:'center', gap:4 }}><XCircle size={11} /> invalid key</span>
    if (t === 'rate_limited' || s) {
      const until = s ? new Date(s.until).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : ''
      return <span style={{ color:'#d97706', display:'flex', alignItems:'center', gap:4 }}><AlertTriangle size={11} /> {s?.reason === 'quota' ? 'daily limit' : 'rate limited'}{until ? ` · back ${until}` : ''}</span>
    }
    if (t === 'fail') return <span style={{ color:'#dc2626', display:'flex', alignItems:'center', gap:4 }}><XCircle size={11} /> failed</span>
    return <span style={{ color:'#94a3b8' }}>ready</span>
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:28, marginBottom:20 }
  const small = { display:'flex', alignItems:'center', gap:5, padding:'6px 11px', background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12, fontWeight:600, color:'#374151', cursor:'pointer' }
  const icon = { background:'none', border:'none', padding:4, cursor:'pointer', color:'#94a3b8', display:'flex' }

  return (
    <div style={card}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
        <div style={{ width:36, height:36, borderRadius:8, background: keys[provider].length ? '#dcfce7' : '#fef3c7', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <KeyRound size={18} color={keys[provider].length ? '#16a34a' : '#d97706'} />
        </div>
        <div>
          <div style={{ fontWeight:600, fontSize:15, color:'#1a202c' }}>API keys &amp; models</div>
          <div style={{ fontSize:12, color:'#718096' }}>Add several keys — when one hits its limit, the next takes over. Stored in this browser only.</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'#f1f5f9', borderRadius:8, padding:3, marginBottom:14 }}>
        {PROVIDERS.map(p => (
          <button key={p} onClick={() => setTab(p)} style={{ flex:1, padding:'6px 8px', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
            background: tab === p ? '#fff' : 'transparent', color: tab === p ? '#4f46e5' : '#64748b' }}>
            {PROVIDER_LABEL[p]} ({keys[p].length}){p === provider ? ' · in use' : ''}
          </button>
        ))}
      </div>

      {/* Keys */}
      {list.length ? (
        <div style={{ border:'1px solid #e2e8f0', borderRadius:8, marginBottom:10 }}>
          {list.map((k, i) => (
            <div key={k} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderBottom: i < list.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize:12.5 }}>
              <span style={{ width:18, color:'#94a3b8', fontSize:11 }}>{i + 1}</span>
              <span style={{ fontFamily:'monospace', flex:1 }}>{maskKey(k)}</span>
              <span style={{ fontSize:11.5, minWidth:150 }}>{badge(k)}</span>
              <button onClick={() => runTest(k)} style={{ ...small, padding:'3px 8px', fontSize:11 }}>Test</button>
              {status[k] && <button onClick={() => { clearKeyStatus(k); setStatus(keyStatus()) }} title="Use it again now" style={icon}><RotateCcw size={13} /></button>}
              <button disabled={i === 0} onClick={() => updateKeys({ ...keys, [tab]: move(list, i, -1) })} title="Use earlier" style={{ ...icon, opacity: i === 0 ? 0.3 : 1 }}><ArrowUp size={13} /></button>
              <button disabled={i === list.length - 1} onClick={() => updateKeys({ ...keys, [tab]: move(list, i, 1) })} title="Use later" style={{ ...icon, opacity: i === list.length - 1 ? 0.3 : 1 }}><ArrowDown size={13} /></button>
              <button onClick={() => updateKeys({ ...keys, [tab]: list.filter(x => x !== k) })} title="Remove" style={{ ...icon, color:'#dc2626' }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize:12.5, color:'#92400e', background:'#fef3c7', borderRadius:8, padding:'9px 12px', marginBottom:10 }}>
          No {PROVIDER_LABEL[tab]} key yet{tab === provider ? ' — AI features are off until you add one' : ''}.
        </div>
      )}

      <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2}
        placeholder={'Paste one or more keys — one per line (AIza… = Gemini, gsk_… = Groq, xai-… = Grok)'}
        style={{ width:'100%', padding:'8px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, fontFamily:'monospace', boxSizing:'border-box', resize:'vertical' }} />
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8, alignItems:'center' }}>
        <button disabled={!paste.trim()} onClick={() => { addKeys(parseKeyFile(paste, tab), 'the box'); setPaste('') }}
          style={{ ...small, background: paste.trim() ? '#4f46e5' : '#a5b4fc', borderColor:'transparent', color:'#fff', cursor: paste.trim() ? 'pointer' : 'not-allowed' }}>
          <Plus size={13} /> Add keys
        </button>
        <button onClick={() => fileRef.current?.click()} style={small}><Upload size={13} /> Import .txt</button>
        <button onClick={exportFile} disabled={!PROVIDERS.some(p => keys[p].length)} style={small}><Download size={13} /> Export .txt</button>
        <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display:'none' }}
          onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f) }} />
        {note && <span style={{ fontSize:12, color:'#15803d' }}>{note}</span>}
      </div>
      <div style={{ fontSize:11, color:'#94a3b8', marginTop:6 }}>
        .txt file: one key per line; lines starting with # are ignored; write <code>gemini: KEY</code> if a key's provider isn't clear from its start.
        Get Gemini keys at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color:'#6366f1' }}>aistudio.google.com</a>.
      </div>

      {/* Models */}
      <div style={{ marginTop:18, borderTop:'1px solid #f1f5f9', paddingTop:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:8 }}>
          <Cpu size={13} /> {PROVIDER_LABEL[tab]} models — first one first; the next is used if one is unavailable or busy
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:8 }}>
          {models[tab].map((m, i) => (
            <div key={m} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, padding:'5px 10px', background:'#f8fafc', borderRadius:7 }}>
              <span style={{ width:18, color:'#94a3b8', fontSize:11 }}>{i + 1}</span>
              <span style={{ fontFamily:'monospace', flex:1 }}>{m}</span>
              <button disabled={i === 0} onClick={() => updateModels({ ...models, [tab]: move(models[tab], i, -1) })} style={{ ...icon, opacity: i === 0 ? 0.3 : 1 }}><ArrowUp size={13} /></button>
              <button disabled={i === models[tab].length - 1} onClick={() => updateModels({ ...models, [tab]: move(models[tab], i, 1) })} style={{ ...icon, opacity: i === models[tab].length - 1 ? 0.3 : 1 }}><ArrowDown size={13} /></button>
              <button disabled={models[tab].length === 1} onClick={() => updateModels({ ...models, [tab]: models[tab].filter(x => x !== m) })} style={{ ...icon, color:'#dc2626', opacity: models[tab].length === 1 ? 0.3 : 1 }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="Add a model name, e.g. gemini-2.5-flash"
            onKeyDown={e => { if (e.key === 'Enter' && newModel.trim()) { updateModels({ ...models, [tab]: [...models[tab], newModel.trim()] }); setNewModel('') } }}
            style={{ flex:1, minWidth:200, padding:'7px 11px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12.5, fontFamily:'monospace' }} />
          <button disabled={!newModel.trim()} onClick={() => { updateModels({ ...models, [tab]: [...models[tab], newModel.trim()] }); setNewModel('') }} style={small}><Plus size={13} /> Add model</button>
          <button onClick={() => updateModels({ ...models, [tab]: DEFAULT_MODELS[tab] })} style={small}><RotateCcw size={13} /> Defaults</button>
        </div>
      </div>
    </div>
  )
}
