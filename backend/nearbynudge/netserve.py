"""Serve on both 127.0.0.1 and ::1, so "localhost" works for every client on Windows.

Windows resolves localhost to ::1 first; browsers fall back to IPv4 quickly, but some clients don't,
so the app listens on both loopback addresses. Either way it's reachable only from this computer.
"""

from __future__ import annotations

import socket
from typing import Any

import uvicorn


def loopback_sockets(port: int) -> list[socket.socket]:
    socks: list[socket.socket] = []
    s4 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s4.bind(("127.0.0.1", port))
    socks.append(s4)
    try:
        s6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        s6.bind(("::1", port))
        socks.append(s6)
    except OSError:  # no IPv6 loopback on this machine: IPv4 alone is fine
        pass
    return socks


def serve(app: Any, port: int, *, host: str = "127.0.0.1", log_level: str = "info", factory: bool = False) -> None:
    config = uvicorn.Config(app, log_level=log_level, factory=factory, proxy_headers=False)
    server = uvicorn.Server(config)
    if host in ("127.0.0.1", "localhost"):
        server.run(sockets=loopback_sockets(port))
    else:  # an explicit address (for example 0.0.0.0 behind a reverse proxy)
        config.host = host
        config.port = port
        server.run()
