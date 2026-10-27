import { useEffect, useState } from 'react'
import { CheckCircle, Loader, MinusCircle, Circle, XCircle, Zap, Clock, Flag } from 'lucide-react'

// What Daraz Upload does in the background, step by step: before a run what
// will happen with the chosen options, while it runs where it is (n of N, time
// left, what the AI just answered), after it how long each step took and what
// it gave. The processor reports the steps (processDarazFiles' onProgress).
export const STEPS = [
  { id: 'read', label: 'Read the files', what: 'Price, Basic, Weight, SKU Image, Attribute and the CartUp template\'s dropdown lists' },
  { id: 'content', label: 'AI cleans names, highlights, description', ai: true, unit: 'product', what: 'Gemini fixes spelling and grammar — 5 products per request' },
  { id: 'rows', label: 'Build one row per Seller SKU', unit: 'row', what: 'CartUp category from the mapping table, brand, images, weight, price checks' },
  { id: 'combo', label: 'AI reads Variations Combo', ai: true, unit: 'product', what: 'which part is the colour and which the size — 25 products per request' },
  { id: 'match', label: 'Match values to CartUp\'s lists', what: 'Color, Size, Brand, Warranty… — spelling, sizes, ranges, rules' },
  { id: 'prepare', label: 'Find what the rules couldn\'t finish', unit: 'product', what: 'values not on the lists, variants numbered apart or alike' },
  { id: 'pick', label: 'AI picks the closest CartUp values', ai: true, unit: 'product', what: 'only values on CartUp\'s list, only the seller\'s own words' },
  { id: 'apply', label: 'Apply and check the AI\'s picks', what: 'every pick checked again by the rules' },
  { id: 'category', label: 'AI checks categories', ai: true, unit: 'product', what: 'products without a CartUp category (no mapping) → the closest one, only from those sharing the product\'s words — 15 products per request' },
]

const time = ms => {
  const s = Math.round(ms / 1000)
  return s < 1 ? '<1s' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// steps: the run's steps ({ id: { status, start, end, done, total, last, note, reason } });
// plan: { id: why it won't run } for the chosen options; run: { start, end } | null;
// state: '' | 'processing' | 'success' | 'error'; ai: the run's AI use (calls, tokens, key…).
export default function ProcessSteps({ steps, plan, run, state, error, ai }) {
  // Processing — or a step run on its own afterwards (the AI category check button).
  const running = state === 'processing' || Object.values(steps).some(s => s?.status === 'active')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  const started = !!run
  const statusOf = s => {
    const st = steps[s.id]
    if (st) return state === 'error' && st.status === 'active' ? { ...st, status: 'failed' } : st
    if (plan[s.id]) return { status: 'skip', reason: plan[s.id] }
    return { status: 'pending' }
  }
  const list = STEPS.map(s => ({ ...s, st: statusOf(s) }))
  const todo = list.filter(s => s.st.status !== 'skip')
  const at = todo.findIndex(s => s.st.status === 'active' || s.st.status === 'failed')
  const elapsed = run ? (run.end || now) - run.start : 0

  return (
    <div data-process-steps style={{ flex:1, overflow:'auto', padding:'14px 16px', minHeight:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
        {running ? <Loader size={16} color='#4f46e5' style={{ animation:'spin 1s linear infinite' }} />
          : state === 'success' && started ? <CheckCircle size={16} color='#16a34a' />
          : state === 'error' && started ? <XCircle size={16} color='#dc2626' /> : <Flag size={15} color='#4f46e5' />}
        <div style={{ fontWeight:700, fontSize:14, color:'#1a202c' }}>
          {running ? 'Processing' : state === 'success' && started ? 'Done' : state === 'error' && started ? 'Stopped' : 'What happens when you click Process'}
        </div>
        {started && (
          <div data-elapsed style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:4, fontSize:12, color:'#64748b', fontVariantNumeric:'tabular-nums' }}>
            <Clock size={12} /> {time(elapsed)}{running && at >= 0 ? ` · step ${at + 1} of ${todo.length}` : ''}
          </div>
        )}
      </div>
      <div style={{ fontSize:11.5, color:'#64748b', marginBottom:12 }}>
        {running ? 'Live — each step as it runs in the background. You can look at the files meanwhile.'
          : state === 'success' && started ? 'How long each step took and what it gave.'
          : state === 'error' && started ? error
          : `${todo.length} steps with the options chosen${todo.some(s => s.ai) ? ` · ${todo.filter(s => s.ai).length} with the AI` : ' · no AI'} — greyed steps are off.`}
      </div>
      {ai && started && (ai.calls > 0 || running) && (
        <div data-ai-use style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', fontSize:11.5, color:'#4338ca', background:'#eef2ff', borderRadius:8, padding:'6px 10px', marginBottom:12, fontVariantNumeric:'tabular-nums' }}>
          <Zap size={12} /> AI · {ai.calls.toLocaleString()} request{ai.calls === 1 ? '' : 's'}{ai.failed ? ` (${ai.failed} failed)` : ''} · {ai.tokens.toLocaleString()} tokens
          {running && ai.key && <span style={{ color:'#64748b' }}>· now Key {ai.keyNo || '?'} on {ai.model}</span>}
        </div>
      )}

      {list.map((s, i) => {
        const { st } = s, last = i === list.length - 1 && !(state === 'success' && started)
        const color = { done: '#16a34a', active: '#4f46e5', failed: '#dc2626', skip: '#cbd5e1', pending: '#cbd5e1' }[st.status]
        const Icon = { done: CheckCircle, active: Loader, failed: XCircle, skip: MinusCircle, pending: Circle }[st.status]
        const active = st.status === 'active'
        const left = active && st.total && st.done ? ((now - st.start) / st.done) * (st.total - st.done) : null
        return (
          <div key={s.id} data-step={s.id} data-step-status={st.status} style={{ display:'flex', gap:10 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:18, flexShrink:0 }}>
              <Icon size={18} color={color} style={active ? { animation:'spin 1.2s linear infinite' } : undefined} />
              {!last && <div style={{ width:2, flex:1, minHeight:10, background: st.status === 'done' ? '#bbf7d0' : '#e2e8f0', margin:'3px 0' }} />}
            </div>
            <div style={{ flex:1, minWidth:0, paddingBottom:12, ...(active ? { background:'#f5f7ff', margin:'-4px 0 8px', padding:'4px 10px 10px', borderRadius:8 } : {}) }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontWeight:600, fontSize:12.5, color: st.status === 'skip' ? '#94a3b8' : '#1a202c', textDecoration: st.status === 'skip' ? 'line-through' : 'none' }}>{s.label}</span>
                {s.ai && <span style={{ fontSize:9.5, fontWeight:800, letterSpacing:0.4, padding:'1px 5px', borderRadius:4, background: st.status === 'skip' ? '#f1f5f9' : '#ede9fe', color: st.status === 'skip' ? '#94a3b8' : '#6d28d9' }}>AI</span>}
                <span style={{ marginLeft:'auto', fontSize:11.5, color:'#64748b', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
                  {st.status === 'done' && st.end ? time(st.end - st.start) : active ? time(now - st.start) : ''}
                </span>
              </div>
              <div style={{ fontSize:11.5, color: st.status === 'done' ? '#15803d' : st.status === 'failed' ? '#b91c1c' : '#64748b', lineHeight:1.45 }}>
                {st.status === 'done' && st.note ? st.note : st.status === 'skip' ? `Off — ${st.reason}` : st.status === 'failed' ? error : s.what}
              </div>
              {active && st.total > 0 && (
                <div style={{ marginTop:6 }}>
                  <div style={{ height:6, background:'#e0e7ff', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ width:`${Math.round(((st.done || 0) / st.total) * 100)}%`, height:'100%', background:'#4f46e5', transition:'width 0.4s' }} />
                  </div>
                  <div style={{ fontSize:11, color:'#4338ca', marginTop:3, fontVariantNumeric:'tabular-nums' }}>
                    {(st.done || 0).toLocaleString()} of {st.total.toLocaleString()} {s.unit}s{left != null ? ` · ≈ ${time(left)} left` : ''}
                  </div>
                </div>
              )}
              {active && st.last?.length > 0 && (
                <div data-step-feed style={{ marginTop:6, display:'flex', flexDirection:'column', gap:2 }}>
                  {st.last.slice(0, 4).map((l, j) => (
                    <div key={j} title={l} style={{ fontSize:11, color: j ? '#94a3b8' : '#334155', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
      {state === 'success' && started && (
        <div data-step="ready" style={{ display:'flex', gap:10, alignItems:'center' }}>
          <Flag size={18} color='#16a34a' style={{ flexShrink:0 }} />
          <span style={{ fontWeight:700, fontSize:12.5, color:'#15803d' }}>Ready — see the check list, review, download</span>
        </div>
      )}
    </div>
  )
}
