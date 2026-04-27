'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.proxy.rapold.io'
const MAX_ROWS = 120

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + s[i]
}

function codeClass(code) {
  const n = parseInt(code, 10)
  if (n === 0) return 'code-ok'
  if (n >= 40 && n <= 79) return 'code-auth'
  return 'code-err'
}

function copyToClipboard(text, cb) {
  navigator.clipboard?.writeText(text).then(cb)
}

// ── Components ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'blue' }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function CodeBlock({ lines, copyText }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    copyToClipboard(copyText, () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="code-block">
      <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy}>
        {copied ? '✓ copied' : 'copy'}
      </button>
      {lines.map((l, i) => (
        <div key={i}>
          <span className="key">{l.key}</span>
          <span className="val">{l.val}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [rows, setRows]       = useState([])
  const [stats, setStats]     = useState({})
  const [status, setStatus]   = useState('loading') // loading | online | offline
  const [sessionReq, setSReq] = useState(0)
  const [sessionOut, setSOut] = useState(0)
  const [sessionIn, setSIn]   = useState(0)
  const newRowIds             = useRef(new Set())
  const esRef                 = useRef(null)

  // ── Stats fetch ──────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/stats`, { cache: 'no-store' })
      if (!r.ok) throw new Error()
      setStats(await r.json())
      setStatus('online')
    } catch {
      setStatus('offline')
    }
  }, [])

  // ── Recent log fetch ─────────────────────────────────────────────────────
  const fetchRecent = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/recent`, { cache: 'no-store' })
      if (!r.ok) throw new Error()
      const data = await r.json()
      setRows(data.slice(0, MAX_ROWS))
      setStatus('online')
    } catch {
      setStatus('offline')
    }
  }, [])

  // ── SSE live stream ──────────────────────────────────────────────────────
  useEffect(() => {
    let es
    let retryTimer

    const connect = () => {
      es = new EventSource(`${API}/events`)
      esRef.current = es

      es.onopen = () => setStatus('online')

      es.onmessage = (e) => {
        const entry = JSON.parse(e.data)
        const id = `${entry.ts}-${entry.client_ip}-${entry.client_port}`
        newRowIds.current.add(id)
        setTimeout(() => newRowIds.current.delete(id), 600)

        setRows(prev => [entry, ...prev].slice(0, MAX_ROWS))
        setSReq(n => n + 1)
        setSOut(n => n + entry.out_bytes)
        setSIn(n  => n + entry.in_bytes)
        fetchStats()
      }

      es.onerror = () => {
        setStatus('offline')
        es.close()
        retryTimer = setTimeout(connect, 4000)
      }
    }

    fetchRecent()
    fetchStats()
    connect()

    const statsInterval = setInterval(fetchStats, 15000)

    return () => {
      es?.close()
      clearTimeout(retryTimer)
      clearInterval(statsInterval)
    }
  }, [fetchRecent, fetchStats])

  // ── Derived stats ────────────────────────────────────────────────────────
  const users       = Object.entries(stats)
  const totalReq    = users.reduce((s, [, v]) => s + v.requests, 0)
  const totalOut    = users.reduce((s, [, v]) => s + v.out_bytes, 0)
  const totalIn     = users.reduce((s, [, v]) => s + v.in_bytes, 0)
  const maxOut      = Math.max(...users.map(([, v]) => v.out_bytes), 1)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="layout">

      {/* Header */}
      <header>
        <div className="header-left">
          <div className="logo">proxy<span>-ch</span></div>
          <div className="ch-badge">🇨🇭 Zürich</div>
        </div>
        <div className={`status-badge ${status}`}>
          <div className={`dot${status === 'online' ? ' pulse' : ''}`} />
          {status === 'loading' ? 'Connecting…' : status === 'online' ? 'Live' : 'Offline'}
        </div>
      </header>

      {/* Egress bar */}
      <div className="egress-bar">
        <div className="egress-item">
          <span className="egress-label">Egress IP</span>
          <span className="egress-value" style={{color:'var(--green)'}}>213.3.19.53</span>
        </div>
        <div className="egress-item">
          <span className="egress-label">City</span>
          <span className="egress-value">Zürich</span>
        </div>
        <div className="egress-item">
          <span className="egress-label">Country</span>
          <span className="egress-value">🇨🇭 CH</span>
        </div>
        <div className="egress-item">
          <span className="egress-label">ASN</span>
          <span className="egress-value">AS3303 Swisscom</span>
        </div>
        <div className="egress-item">
          <span className="egress-label">HTTP Port</span>
          <span className="egress-value">38128</span>
        </div>
        <div className="egress-item">
          <span className="egress-label">SOCKS5 Port</span>
          <span className="egress-value">31080</span>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <StatCard label="Total Requests"  value={totalReq.toLocaleString()} color="blue"   sub="all users, all time" />
        <StatCard label="Total Egress"    value={fmt(totalOut)}             color="green"  sub="bytes sent upstream" />
        <StatCard label="Total Ingress"   value={fmt(totalIn)}              color="orange" sub="bytes received" />
        <StatCard label="Active Users"    value={users.length}              color="purple" sub="unique proxy users" />
        <StatCard label="Session Requests" value={sessionReq.toLocaleString()} color="blue"  sub="since page load" />
        <StatCard label="Session Egress"  value={fmt(sessionOut)}           color="green"  sub="since page load" />
      </div>

      {/* Live traffic */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">Live Traffic Stream</span>
          <span className="section-meta">{rows.length} entries</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Client IP</th>
                <th>Destination</th>
                <th>Proto</th>
                <th>Code</th>
                <th>↑ Out</th>
                <th>↓ In</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="empty">No traffic yet — waiting for connections…</td></tr>
              ) : rows.map((e, i) => {
                const id = `${e.ts}-${e.client_ip}-${e.client_port}`
                const isNew = newRowIds.current.has(id)
                const dest = e.hostname && e.hostname !== '-' ? e.hostname : e.remote
                const port = e.remote_port !== 80 && e.remote_port !== 443 ? `:${e.remote_port}` : ''
                return (
                  <tr key={`${id}-${i}`} className={isNew ? 'flash' : ''}>
                    <td>{e.ts}</td>
                    <td><span className="user-chip">{e.user}</span></td>
                    <td>{e.client_ip}</td>
                    <td className="hostname">{dest}{port}</td>
                    <td>{e.proto}</td>
                    <td className={codeClass(e.code)}>{e.code}</td>
                    <td>{fmt(e.out_bytes)}</td>
                    <td>{fmt(e.in_bytes)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-user stats */}
      {users.length > 0 && (
        <div className="section">
          <div className="section-header">
            <span className="section-title">Per-user Stats</span>
          </div>
          <div className="user-grid">
            {users.sort((a,b) => b[1].requests - a[1].requests).map(([user, v]) => (
              <div className="user-card" key={user}>
                <div className="user-name">{user}</div>
                <div className="user-stats">
                  <div>
                    <div className="user-stat-label">Requests</div>
                    <div className="user-stat-val" style={{color:'var(--blue)'}}>{v.requests.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="user-stat-label">Egress</div>
                    <div className="user-stat-val" style={{color:'var(--green)'}}>{fmt(v.out_bytes)}</div>
                  </div>
                  <div>
                    <div className="user-stat-label">Ingress</div>
                    <div className="user-stat-val" style={{color:'var(--orange)'}}>{fmt(v.in_bytes)}</div>
                  </div>
                </div>
                <div className="bar-bg">
                  <div className="bar-fill" style={{width: `${Math.round(v.out_bytes / maxOut * 100)}%`}} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection guide */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">Connect</span>
        </div>
        <div className="connect-grid">

          <div className="connect-card">
            <h3>HTTP Proxy <span className="tag">recommended</span></h3>
            <p style={{fontSize:12,color:'var(--muted)',marginBottom:10}}>
              Run <code style={{fontFamily:'var(--mono)',color:'var(--blue)'}}>cloudflared access tcp</code> once, then configure any app:
            </p>
            <CodeBlock
              copyText={`cloudflared access tcp --hostname proxy.rapold.io --url localhost:8128`}
              lines={[
                { key: '$ ', val: 'cloudflared access tcp --hostname proxy.rapold.io --url localhost:8128' },
              ]}
            />
            <div style={{marginTop:10}}>
              <CodeBlock
                copyText={`Protocol: HTTP\nHost: 127.0.0.1\nPort: 8128`}
                lines={[
                  { key: 'Protocol  ', val: 'HTTP' },
                  { key: 'Host      ', val: '127.0.0.1' },
                  { key: 'Port      ', val: '8128' },
                ]}
              />
            </div>
          </div>

          <div className="connect-card">
            <h3>SOCKS5</h3>
            <p style={{fontSize:12,color:'var(--muted)',marginBottom:10}}>
              Same approach via the SOCKS5 tunnel:
            </p>
            <CodeBlock
              copyText={`cloudflared access tcp --hostname socks.rapold.io --url localhost:1080`}
              lines={[
                { key: '$ ', val: 'cloudflared access tcp --hostname socks.rapold.io --url localhost:1080' },
              ]}
            />
            <div style={{marginTop:10}}>
              <CodeBlock
                copyText={`socks5://127.0.0.1:1080`}
                lines={[
                  { key: 'Protocol  ', val: 'SOCKS5' },
                  { key: 'Host      ', val: '127.0.0.1' },
                  { key: 'Port      ', val: '1080' },
                ]}
              />
            </div>
          </div>

          <div className="connect-card">
            <h3>Install cloudflared</h3>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <CodeBlock copyText="brew install cloudflared"
                lines={[{key:'macOS    ', val:'brew install cloudflared'}]} />
              <CodeBlock copyText="winget install Cloudflare.cloudflared"
                lines={[{key:'Windows  ', val:'winget install Cloudflare.cloudflared'}]} />
              <CodeBlock copyText="curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb && sudo dpkg -i cf.deb"
                lines={[{key:'Linux    ', val:'curl -fsSL …cloudflared-linux-amd64.deb | dpkg -i'}]} />
            </div>
          </div>

        </div>
      </div>

      <footer>
        proxy-ch · pve1.rapold.io · CT 105 · 3proxy + Cloudflare Tunnel ·{' '}
        <a href="https://github.com/muraschal/proxy" style={{color:'var(--blue)',textDecoration:'none'}}>
          github.com/muraschal/proxy
        </a>
      </footer>

    </div>
  )
}
