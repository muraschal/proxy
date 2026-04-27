import { NextResponse } from 'next/server'

// Only allow access from the CH proxy egress IP.
// To access the dashboard, you must route your browser through the proxy first.
const ALLOWED_IPS = (process.env.ALLOWED_IPS || '213.3.19.53').split(',').map(s => s.trim())

export function middleware(request) {
  // Skip API routes (proxy-api.rapold.io handles its own CORS)
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/api/')) return NextResponse.next()

  const forwarded = request.headers.get('x-forwarded-for') || ''
  const realIp    = request.headers.get('x-real-ip') || ''
  const clientIp  = forwarded.split(',')[0].trim() || realIp

  if (ALLOWED_IPS.includes(clientIp)) {
    return NextResponse.next()
  }

  // Block with a minimal, informative HTML page
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>proxy-ch · Access Restricted</title>
  <style>
    body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
    .box{max-width:440px;padding:40px 32px}
    h1{font-size:20px;font-weight:700;margin-bottom:12px}
    p{color:#8b949e;font-size:14px;line-height:1.6;margin-bottom:24px}
    code{font-family:monospace;background:#161b22;border:1px solid #30363d;
         border-radius:6px;padding:10px 14px;display:block;font-size:13px;
         color:#58a6ff;word-break:break-all;margin-bottom:8px}
    .ip{color:#f85149;font-family:monospace;font-size:13px}
  </style>
</head>
<body>
  <div class="box">
    <h1>🇨🇭 Access Restricted</h1>
    <p>This dashboard is only accessible through the CH proxy.<br/>
       Connect first, then reload.</p>
    <code>cloudflared access tcp --hostname tcp.rapold.io --url localhost:8128</code>
    <code>Set proxy → 127.0.0.1:8128 in your browser</code>
    <p style="margin-bottom:0">Your IP: <span class="ip">${clientIp || 'unknown'}</span><br/>
       Required: <span style="color:#3fb950;font-family:monospace">213.3.19.53</span></p>
  </div>
</body>
</html>`,
    {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  )
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'],
}
