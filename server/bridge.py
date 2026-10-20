"""Міст між сервером чату (Node) і рідним протоколом Hermes gateway.

Підключається офіційним клієнтом Hermes (hermes_cli.gateway_client: пошук gateway, квиток через
owner-only сокет, WebSocket /api/ws) і перекладає JSON-RPC у рядки JSON на stdin/stdout:

  Node → міст:  {"id": 1, "method": "prompt.submit", "params": {...}, "timeout": 30}
                {"id": 2, "http": {"method": "GET", "path": "/api/mcp/catalog", "body": null}, "timeout": 30}
                {"id": 3, "catalog": "notion"}   — блок mcp_servers.<name>, який Hermes записав би для запису каталогу
                {"respond": "<id запиту gateway>", "result": {...}}   — відповідь на server→client запит
  міст → Node:  {"ready": true}
                {"id": 1, "result": {...}}  або  {"id": 1, "error": {"reason": "...", "code": .., "data": {..}}}
                {"id": 2, "result": {"status": 200, "body": <JSON або текст>}}
                {"event": {...params події...}}
                {"request": {"id": "...", "method": "approval", "params": {...}}}
                {"closed": "причина"}  — і процес завершується; Node перезапустить міст.

HTTP-маршрути gateway (/api/mcp/… тощо) викликаються з одноразовим квитком native-http через той самий
owner-only сокет: без Origin, лише з loopback.

Запускається Python-ом із venv Hermes з PYTHONPATH=~/.hermes/hermes-agent.
"""
import asyncio
import json
import math
import sys
import urllib.error
import urllib.request

from hermes_cli.gateway_client import GatewayClientError, GatewayRPCError, _session_ticket, connect_gateway
from hermes_cli.gateway_runtime import attachable, ensure_gateway_runtime, gateway_profile_home
from hermes_constants import get_hermes_home

out_lock = asyncio.Lock()


async def out(obj):
    line = json.dumps(obj, ensure_ascii=False, default=str)
    async with out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


async def handle(client, msg):
    rid = msg.get("id")
    try:
        timeout = msg.get("timeout")
        budget = math.inf if timeout == "inf" else timeout
        result = await client.rpc(msg["method"], _timeout=budget, **(msg.get("params") or {}))
        await out({"id": rid, "result": result})
    except GatewayRPCError as exc:
        await out({"id": rid, "error": {"reason": str(exc), "code": exc.code, "data": exc.data}})
    except Exception as exc:  # транспорт, таймаут
        await out({"id": rid, "error": {"reason": type(exc).__name__, "message": str(exc)[:300]}})


# Gateway на loopback: системний HTTP(S)-проксі тут лише заважає.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_endpoint = None


def _owner(refresh):
    global _endpoint
    if _endpoint is None or refresh:
        home = gateway_profile_home(get_hermes_home())
        res = ensure_gateway_runtime(home, idle_exit=True)
        if not attachable(res):
            raise GatewayClientError(f"Gateway {res.state}: {res.reason_code or 'not_ready'}")
        _endpoint = (home, res.endpoint)
    return _endpoint


def _http(method, path, body, timeout):
    # Адреса слухача gateway змінюється після його перезапуску: тоді один раз шукаємо наново.
    for attempt in (0, 1):
        home, endpoint = _owner(refresh=attempt == 1)
        headers = {"x-hermes-gateway-ticket": _session_ticket(home, endpoint, purpose="native-http")}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        req = urllib.request.Request(endpoint.api_origin + path, data=data, method=method, headers=headers)
        try:
            with _opener.open(req, timeout=timeout) as res:
                status, raw = res.status, res.read()
        except urllib.error.HTTPError as exc:
            status, raw = exc.code, exc.read()
        except OSError:
            if attempt:
                raise
            continue
        text = raw.decode("utf-8", "replace")
        try:
            return {"status": status, "body": json.loads(text)}
        except ValueError:
            return {"status": status, "body": text[:2000]}


def _catalog_config(name):
    # Той самий блок, що й у картки підключення Hermes: з добраним фільтром інструментів, без запису.
    from hermes_cli import mcp_catalog

    entry = mcp_catalog.get_entry(name)
    if entry is None:
        raise LookupError(f"немає в каталозі: {name}")
    if entry.install is not None:
        raise ValueError("цей запис треба встановлювати через Hermes")
    return mcp_catalog.card_install_config(entry)


async def handle_catalog(msg):
    try:
        await out({"id": msg.get("id"), "result": await asyncio.to_thread(_catalog_config, msg["catalog"])})
    except Exception as exc:
        await out({"id": msg.get("id"), "error": {"reason": type(exc).__name__, "message": str(exc)[:300]}})


async def handle_http(msg):
    rid = msg.get("id")
    req = msg["http"]
    try:
        result = await asyncio.to_thread(_http, req["method"], req["path"], req.get("body"), msg.get("timeout") or 30)
        await out({"id": rid, "result": result})
    except Exception as exc:
        await out({"id": rid, "error": {"reason": type(exc).__name__, "message": str(exc)[:300]}})


async def pump_events(client):
    while True:
        frame = await client.events.get()
        if isinstance(frame, Exception):
            await out({"closed": str(frame)[:300]})
            return
        if "id" in frame and "method" in frame:
            await out({"request": {"id": frame["id"], "method": frame["method"], "params": frame.get("params") or {}}})
        else:
            await out({"event": frame.get("params") or {}})


async def pump_stdin(client):
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=16 * 1024 * 1024)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    while True:
        line = await reader.readline()
        if not line:
            return  # Node закрив stdin — виходимо
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "respond" in msg:
            frame = {"jsonrpc": "2.0", "id": msg["respond"]}
            if "error" in msg:
                frame["error"] = msg["error"]
            else:
                frame["result"] = msg.get("result", {})
            await client.websocket.send(json.dumps(frame))
        elif "http" in msg:
            asyncio.create_task(handle_http(msg))
        elif "catalog" in msg:
            asyncio.create_task(handle_catalog(msg))
        elif "method" in msg:
            asyncio.create_task(handle(client, msg))


async def main():
    try:
        async with connect_gateway() as client:
            caps = await client.rpc("client.capabilities", server_requests=True)
            await out({"ready": True, "capabilities": caps})
            done, pending = await asyncio.wait(
                [asyncio.create_task(pump_events(client)), asyncio.create_task(pump_stdin(client))],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except Exception as exc:
        await out({"closed": f"{type(exc).__name__}: {exc}"[:300]})


if __name__ == "__main__":
    asyncio.run(main())
