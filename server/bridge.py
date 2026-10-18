"""Міст між сервером чату (Node) і рідним протоколом Hermes gateway.

Підключається офіційним клієнтом Hermes (hermes_cli.gateway_client: пошук gateway, квиток через
owner-only сокет, WebSocket /api/ws) і перекладає JSON-RPC у рядки JSON на stdin/stdout:

  Node → міст:  {"id": 1, "method": "prompt.submit", "params": {...}, "timeout": 30}
                {"respond": "<id запиту gateway>", "result": {...}}   — відповідь на server→client запит
  міст → Node:  {"ready": true}
                {"id": 1, "result": {...}}  або  {"id": 1, "error": {"reason": "...", "code": .., "data": {..}}}
                {"event": {...params події...}}
                {"request": {"id": "...", "method": "approval", "params": {...}}}
                {"closed": "причина"}  — і процес завершується; Node перезапустить міст.

Запускається Python-ом із venv Hermes з PYTHONPATH=~/.hermes/hermes-agent.
"""
import asyncio
import json
import math
import sys

from hermes_cli.gateway_client import GatewayRPCError, connect_gateway

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
