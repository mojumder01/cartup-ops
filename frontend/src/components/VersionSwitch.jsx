import { APP_VERSION, OLD_VERSION } from '../version'

// Two buttons — the old version (for anyone who needs it) and the latest —
// with the one running in green. This site is always the latest; the old
// version (built at every deploy, scripts/build-old.mjs) shows the same pair
// with OLD running.
export default function VersionSwitch({ dark = false }) {
  const base = { display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, width:'100%', boxSizing:'border-box', padding:'6px 10px',
    borderRadius:8, fontSize:11, fontWeight:700, textDecoration:'none', lineHeight:1.3 }
  const idle = dark ? { color:'rgba(255,255,255,0.8)', border:'1px solid rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.05)', cursor:'pointer' }
    : { color:'#475569', border:'1px solid #e2e8f0', background:'#fff', cursor:'pointer' }
  const running = { color:'#fff', border:'1px solid #16a34a', background:'#16a34a', boxShadow:'0 0 0 3px rgba(22,163,74,0.2)' }
  return (
    <div data-version-switch style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <a href={OLD_VERSION.path} data-version="old" title={`Open the old version (v${OLD_VERSION.version}) — for anyone who needs it`} style={{ ...base, ...idle }}>
        <span>OLD: v{OLD_VERSION.version}</span><span style={{ fontWeight:500, opacity:0.75 }}>Open →</span>
      </a>
      <span data-version="latest" aria-current="true" title="You are using the latest version" style={{ ...base, ...running }}>
        <span>Latest: v{APP_VERSION}</span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontWeight:600 }}><span className="vs-dot" />Running</span>
      </span>
      <style>{`.vs-dot { width:7px; height:7px; border-radius:50%; background:#fff; animation: vs-pulse 1.4s ease-in-out infinite }
        @keyframes vs-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  )
}
