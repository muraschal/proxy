#!/usr/bin/env python3
"""
proxy-ch Backend API
====================
Reads 3proxy logs in real-time and exposes them via REST + SSE.
Deployed on CT 105 at :8080, reached via Cloudflare Tunnel at api.proxy.rapold.io.

Endpoints:
  GET /api/recent   → last N log entries (JSON)
  GET /api/stats    → per-user aggregate stats (JSON)
  GET /events       → SSE live stream of new log entries
  GET /health       → 200 OK
"""

import asyncio
import glob
import json
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path

from aiohttp import web
from aiohttp.web_middlewares import middleware

LOG_DIR              = os.environ.get("LOG_DIR", "/usr/local/3proxy/logs")
PORT                 = int(os.environ.get("API_PORT", "8080"))
RECENT_LINES         = 500
ALLOWED_ORIGINS      = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://proxy.rapold.io,https://dashboard.rapold.io"
).split(",")

# ── Log parser ────────────────────────────────────────────────────────────────

# Actual log format from 3proxy.cfg:
# logformat "L%y-%m-%d %H:%M:%S %N.%p %E %U %C:%c %R:%r %O %I %h %T"
# Example line:
# L26-04-27 20:35:33 PROXY.38128 00000 chproxy 192.168.1.101:44278 192.178.170.91:443 2018 8869 0 CONNECT www.youtube.com:443 HTTP/1.1
# Fields: date time type.port code user client:port remote:rport out in %h(=0) method hostname [http_ver]
LOG_RE = re.compile(
    r"L?(\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+"  # timestamp
    r"(\w+\.\d+)\s+"                                  # type.port (e.g. PROXY.38128)
    r"(\d+)\s+"                                       # error code
    r"(\S+)\s+"                                       # username
    r"(\S+):(\d+)\s+"                                 # client_ip:port
    r"(\S+):(\d+)\s+"                                 # remote_ip:port
    r"(\d+)\s+"                                       # bytes out
    r"(\d+)\s+"                                       # bytes in
    r"\S+\s+"                                         # %h field (skip — often '0')
    r"(\S+)"                                          # method/proto (CONNECT, GET…)
    r"(?:\s+(\S+))?"                                  # optional: actual hostname:port from %T
)

def parse_line(line: str) -> dict | None:
    m = LOG_RE.match(line.strip())
    if not m:
        return None
    ts, typ, code, user, cip, cport, remote, rport, out_b, in_b, proto, hostname = m.groups()
    return dict(
        ts=ts, type=typ, code=code, user=user,
        client_ip=cip, client_port=int(cport),
        remote=remote, remote_port=int(rport),
        out_bytes=int(out_b), in_bytes=int(in_b),
        hostname=hostname or remote,   # fall back to remote IP if no hostname
        proto=proto,
    )

# ── State ─────────────────────────────────────────────────────────────────────

recent: deque        = deque(maxlen=RECENT_LINES)
stats: dict          = defaultdict(lambda: {"requests": 0, "out_bytes": 0, "in_bytes": 0})
subscribers: list    = []

# ── Log tailer ────────────────────────────────────────────────────────────────

async def tail_logs():
    position = {}
    while True:
        files = sorted(glob.glob(os.path.join(LOG_DIR, "3proxy-*.log")))
        if not files:
            await asyncio.sleep(2)
            continue
        current = files[-1]
        if current not in position:
            # Read from beginning on first open so history is loaded into recent/stats.
            # The deque is capped at RECENT_LINES so memory is bounded.
            position[current] = 0
        try:
            with open(current, "r", errors="replace") as fh:
                fh.seek(position[current])
                for line in fh:
                    entry = parse_line(line)
                    if entry:
                        ingest(entry)
                position[current] = fh.tell()
        except OSError:
            pass
        await asyncio.sleep(0.5)

def ingest(entry: dict):
    recent.appendleft(entry)
    u = entry["user"]
    stats[u]["requests"]  += 1
    stats[u]["out_bytes"] += entry["out_bytes"]
    stats[u]["in_bytes"]  += entry["in_bytes"]
    msg = json.dumps(entry)
    dead = []
    for q in subscribers:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        subscribers.remove(q)

# ── CORS middleware ───────────────────────────────────────────────────────────

@middleware
async def cors_middleware(request, handler):
    origin = request.headers.get("Origin", "")
    allowed = origin in ALLOWED_ORIGINS or not ALLOWED_ORIGINS[0]

    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as e:
            resp = e

    if allowed:
        resp.headers["Access-Control-Allow-Origin"]  = origin or "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

# ── Handlers ──────────────────────────────────────────────────────────────────

async def handle_health(request):
    return web.json_response({"status": "ok", "entries": len(recent)})

async def handle_recent(request):
    return web.json_response(list(recent))

async def handle_stats(request):
    return web.json_response(dict(stats))

async def handle_sse(request):
    response = web.StreamResponse(headers={
        "Content-Type":    "text/event-stream",
        "Cache-Control":   "no-cache",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": request.headers.get("Origin", "*"),
    })
    await response.prepare(request)
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    subscribers.append(q)
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=20)
                await response.write(f"data: {msg}\n\n".encode())
            except asyncio.TimeoutError:
                await response.write(b": keep-alive\n\n")
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        if q in subscribers:
            subscribers.remove(q)
    return response

# ── App ───────────────────────────────────────────────────────────────────────

async def on_startup(app):
    asyncio.create_task(tail_logs())

def create_app():
    app = web.Application(middlewares=[cors_middleware])
    app.on_startup.append(on_startup)
    app.router.add_get("/health",      handle_health)
    app.router.add_get("/api/recent",  handle_recent)
    app.router.add_get("/api/stats",   handle_stats)
    app.router.add_get("/events",      handle_sse)
    return app

if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=PORT)
