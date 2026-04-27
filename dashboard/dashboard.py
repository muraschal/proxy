#!/usr/bin/env python3
"""
proxy-ch Live Traffic Dashboard
================================
Serves a real-time traffic dashboard for the 3proxy forward proxy.

Access control:
  Only clients whose source IP (CF-Connecting-IP header) matches an IP
  that has an *active or recent* proxy connection are allowed in.
  All other requests receive a 403.

Run:
  pip install -r requirements.txt
  python dashboard.py

Listens on: 0.0.0.0:8080
"""

import asyncio
import glob
import json
import os
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web

# ── Configuration ────────────────────────────────────────────────────────────

LOG_DIR = os.environ.get("LOG_DIR", "/usr/local/3proxy/logs")
PORT = int(os.environ.get("DASHBOARD_PORT", "8080"))
# How many seconds back a client IP must have been seen to be "active"
ACTIVE_WINDOW_SECONDS = int(os.environ.get("ACTIVE_WINDOW_SECONDS", "300"))
# Keep this many recent log lines in memory
RECENT_LINES = 500

# ── Log parser ───────────────────────────────────────────────────────────────

# Log format: L<yy>-<mm>-<dd> <HH>:<MM>:<SS> <TYPE>.<N> <code> <user> <client>:<port> <remote>:<rport> <out_bytes> <in_bytes> <hostname> <proto>
LOG_RE = re.compile(
    r"L(\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+"
    r"(\w+\.\d+)\s+"        # type.N
    r"(\d+)\s+"             # code
    r"(\S+)\s+"             # user
    r"(\S+):(\d+)\s+"       # client_ip:port
    r"(\S+):(\d+)\s+"       # remote:port
    r"(\d+)\s+"             # out_bytes
    r"(\d+)\s+"             # in_bytes
    r"(\S+)\s+"             # hostname
    r"(\S+)"                # proto
)

def parse_line(line: str) -> dict | None:
    m = LOG_RE.match(line.strip())
    if not m:
        return None
    ts, typ, code, user, client_ip, client_port, remote, remote_port, out_b, in_b, hostname, proto = m.groups()
    return {
        "ts": ts,
        "type": typ,
        "code": code,
        "user": user,
        "client_ip": client_ip,
        "client_port": int(client_port),
        "remote": remote,
        "remote_port": int(remote_port),
        "out_bytes": int(out_b),
        "in_bytes": int(in_b),
        "hostname": hostname,
        "proto": proto,
    }

# ── State ────────────────────────────────────────────────────────────────────

recent: deque = deque(maxlen=RECENT_LINES)
stats: dict = defaultdict(lambda: {"requests": 0, "out_bytes": 0, "in_bytes": 0})
# client_ip → last seen epoch
seen_ips: dict[str, float] = {}
# SSE subscribers
subscribers: list[asyncio.Queue] = []

# ── Log tailer ───────────────────────────────────────────────────────────────

async def tail_logs():
    """Follow today's (and rolling) 3proxy log file, parse each line."""
    position = {}

    while True:
        pattern = os.path.join(LOG_DIR, "3proxy-*.log")
        files = sorted(glob.glob(pattern))
        if not files:
            await asyncio.sleep(2)
            continue

        # Always tail the most recent file
        current_file = files[-1]
        if current_file not in position:
            # Seek to end on first open to avoid replaying history
            try:
                position[current_file] = os.path.getsize(current_file)
            except OSError:
                position[current_file] = 0

        try:
            with open(current_file, "r", errors="replace") as fh:
                fh.seek(position[current_file])
                while True:
                    line = fh.readline()
                    if not line:
                        position[current_file] = fh.tell()
                        break
                    entry = parse_line(line)
                    if entry:
                        ingest(entry)
        except OSError:
            pass

        await asyncio.sleep(0.5)


def ingest(entry: dict):
    recent.appendleft(entry)
    user = entry["user"]
    stats[user]["requests"] += 1
    stats[user]["out_bytes"] += entry["out_bytes"]
    stats[user]["in_bytes"] += entry["in_bytes"]
    seen_ips[entry["client_ip"]] = time.time()

    # Push to SSE subscribers
    msg = json.dumps(entry)
    dead = []
    for q in subscribers:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        subscribers.remove(q)

# ── Access control ───────────────────────────────────────────────────────────

def get_client_ip(request: web.Request) -> str:
    """Extract real client IP from Cloudflare header (or fallback to peer)."""
    return (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.remote
        or ""
    )

def is_allowed(ip: str) -> bool:
    """Allow if the IP was seen as a proxy client within ACTIVE_WINDOW_SECONDS."""
    last = seen_ips.get(ip)
    if last is None:
        return False
    return (time.time() - last) < ACTIVE_WINDOW_SECONDS

# ── HTTP handlers ─────────────────────────────────────────────────────────────

async def handle_index(request: web.Request) -> web.Response:
    client_ip = get_client_ip(request)
    if not is_allowed(client_ip):
        return web.Response(
            status=403,
            text=f"403 Forbidden — {client_ip} has no active proxy session.\n"
                 f"Connect through the proxy first, then revisit this page.",
        )
    html = Path(__file__).parent / "index.html"
    return web.FileResponse(html)


async def handle_api_recent(request: web.Request) -> web.Response:
    client_ip = get_client_ip(request)
    if not is_allowed(client_ip):
        return web.Response(status=403, text="Forbidden")
    return web.json_response(list(recent))


async def handle_api_stats(request: web.Request) -> web.Response:
    client_ip = get_client_ip(request)
    if not is_allowed(client_ip):
        return web.Response(status=403, text="Forbidden")
    return web.json_response(dict(stats))


async def handle_sse(request: web.Request) -> web.StreamResponse:
    client_ip = get_client_ip(request)
    if not is_allowed(client_ip):
        return web.Response(status=403, text="Forbidden")

    response = web.StreamResponse(headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
    await response.prepare(request)

    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    subscribers.append(q)
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=15)
                await response.write(f"data: {msg}\n\n".encode())
            except asyncio.TimeoutError:
                await response.write(b": keep-alive\n\n")
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        if q in subscribers:
            subscribers.remove(q)
    return response

# ── App factory ───────────────────────────────────────────────────────────────

async def on_startup(app: web.Application):
    asyncio.create_task(tail_logs())


def create_app() -> web.Application:
    app = web.Application()
    app.on_startup.append(on_startup)
    app.router.add_get("/", handle_index)
    app.router.add_get("/api/recent", handle_api_recent)
    app.router.add_get("/api/stats", handle_api_stats)
    app.router.add_get("/events", handle_sse)
    return app


if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=PORT)
