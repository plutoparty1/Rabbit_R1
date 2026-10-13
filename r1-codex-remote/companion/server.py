"""계정 한도와 진단 데이터를 제공하며 Codex 명령 전송은 차단합니다."""
import asyncio
from collections import deque
from contextlib import asynccontextmanager
import os
from pathlib import Path
import secrets
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[1]
COOKIE = "r1_diagnostic_device"


class PairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=32)


class PingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str = Field(min_length=1, max_length=80)


def create_app(origin=None, quota_reader=None, live_monitor=None):
    """출처 한 개만 허용하며 재시작하면 모든 기기 권한을 폐기합니다."""
    origin = origin or os.environ.get("R1_PUBLIC_ORIGIN", "http://127.0.0.1:8787")
    parsed = urlsplit(origin)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or
            parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or
            (parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost"})):
        raise ValueError("외부 출처에는 경로가 없는 HTTPS 주소를 지정해 주세요.")
    @asynccontextmanager
    async def lifespan(app):
        async def update_quota():
            while True:
                try:
                    result = await asyncio.to_thread(quota_reader)
                    if result['status'] == 'ready' or not app.state.quota.get('windows'):
                        app.state.quota = result
                    else:
                        app.state.quota = {**app.state.quota, 'status': 'stale'}
                except Exception:
                    app.state.quota = {**app.state.quota, 'status': 'stale' if app.state.quota.get('windows') else 'unavailable'}
                # 사용 한도 조회만 수행하며 모델 턴은 시작하지 않습니다.
                await asyncio.sleep(60)
        task = asyncio.create_task(update_quota()) if quota_reader else None
        monitor_task = asyncio.create_task(live_monitor.run()) if live_monitor else None
        try:
            yield
        finally:
            for active_task in (task, monitor_task):
                if not active_task:
                    continue
                active_task.cancel()
                try:
                    await active_task
                except asyncio.CancelledError:
                    pass
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.quota = {'status': 'loading' if quota_reader else 'unavailable', 'windows': [], 'checkedAt': None}
    app.state.pair_code = f"{secrets.randbelow(100000000):08d}"
    app.state.pair_expires = time.monotonic() + 120
    app.state.pair_used = False
    app.state.devices = {}
    app.state.rate = deque()
    app.state.host_id = secrets.token_hex(8)

    def snapshot():
        live = live_monitor.snapshot() if live_monitor else {'connected': False, 'sameServerSameThreadProven': False, 'sessions': None}
        return {
            "phase": "diagnostic", "hostId": app.state.host_id, "time": time.time(),
            "codex": {"status": 'events_received' if live['connected'] else 'unverified', "sameServerSameThreadProven": live['sameServerSameThreadProven'],
                      "commandDeliveryEnabled": False, "tokens": None,
                      "reason": "현재 Codex 대화의 실시간 연결은 증명되지 않았습니다."},
            "deviceTest": "not_verified",
            "quota": app.state.quota,
            # 별도 계정 조회 서버의 빈 loaded 목록을 PC 전체 세션 상태로 해석하지 않습니다.
            "sessions": live['sessions'],
            "live": live,
        }

    def authenticated(connection):
        token = connection.cookies.get(COOKIE, "")
        return token in app.state.devices and app.state.devices[token] > time.monotonic()

    def limit():
        now = time.monotonic()
        while app.state.rate and app.state.rate[0] < now - 60:
            app.state.rate.popleft()
        # ponytail: 단일 진단 기기용 전역 제한이며 다중 기기 운영 때 기기별 제한으로 확장합니다.
        if len(app.state.rate) >= 10:
            raise HTTPException(429, "요청이 많습니다. 1분 후 다시 시도해 주세요.")
        app.state.rate.append(now)

    @app.middleware("http")
    async def boundaries(request: Request, call_next):
        if request.headers.get("host") != parsed.netloc:
            return JSONResponse({"detail": "허용되지 않은 호스트입니다."}, status_code=403)
        supplied_origin = request.headers.get("origin")
        if supplied_origin is not None and supplied_origin != origin:
            return JSONResponse({"detail": "허용되지 않은 출처입니다."}, status_code=403)
        if request.method not in {"GET", "HEAD"}:
            if supplied_origin != origin:
                return JSONResponse({"detail": "출처 확인이 필요합니다."}, status_code=403)
            # Content-Length가 없는 분할 요청도 누적 크기를 검사합니다.
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 8192:
                    return JSONResponse({"detail": "요청 크기가 너무 큽니다."}, status_code=413)
            request._body = bytes(body)
        if request.url.path.startswith("/api/") and request.url.path != "/api/pair":
            if not authenticated(request):
                return JSONResponse({"detail": "기기 연결이 필요합니다."}, status_code=401)
        response = await call_next(request)
        response.headers.update({
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        })
        return response

    @app.post("/api/pair")
    async def pair(payload: PairRequest):
        limit()
        if (app.state.pair_used or time.monotonic() >= app.state.pair_expires or
                not secrets.compare_digest(payload.code, app.state.pair_code)):
            raise HTTPException(403, "연결 코드가 잘못되었거나 만료되었습니다. PC에서 다시 시작해 주세요.")
        app.state.pair_used = True
        token = secrets.token_urlsafe(32)
        app.state.devices[token] = time.monotonic() + 3600
        response = JSONResponse({"paired": True, "expiresIn": 3600})
        response.set_cookie(COOKIE, token, httponly=True, secure=parsed.scheme == "https",
                            samesite="strict", max_age=3600, path="/")
        return response

    @app.get("/api/state")
    async def state():
        return snapshot()

    @app.post("/api/diagnostic/ping")
    async def ping(payload: PingRequest):
        limit()
        return {"kind": "diagnostic.echo", "requestId": payload.requestId,
                "hostId": app.state.host_id, "time": time.time(),
                "message": "PC 브리지의 진단 응답입니다. Codex 응답이 아닙니다."}

    @app.post("/api/unpair")
    async def unpair(request: Request):
        app.state.devices.pop(request.cookies.get(COOKIE, ""), None)
        response = JSONResponse({"revoked": True})
        response.delete_cookie(COOKIE, path="/")
        return response

    @app.post("/api/commands")
    async def commands():
        raise HTTPException(409, "동일 서버·대화와 r1 실기 연결 검증 전에는 Codex 전송이 차단됩니다.")

    @app.websocket("/api/events")
    async def events(ws: WebSocket):
        if (ws.headers.get("host") != parsed.netloc or ws.headers.get("origin") != origin or
                not authenticated(ws)):
            await ws.close(code=1008)
            return
        await ws.accept()
        sequence = 0
        try:
            while authenticated(ws):
                sequence += 1
                await ws.send_json({"kind": "diagnostic.snapshot", "sequence": sequence, "state": snapshot()})
                try:
                    message = await asyncio.wait_for(ws.receive(), timeout=1)
                    if message["type"] == "websocket.disconnect":
                        return
                    # 진단 소켓은 읽기 전용이며 임의 RPC를 받지 않습니다.
                    await ws.close(code=1008)
                    return
                except asyncio.TimeoutError:
                    pass
            await ws.close(code=1008)
        except WebSocketDisconnect:
            pass

    @app.get("/")
    async def page():
        return FileResponse(ROOT / "creation" / "index.html")

    @app.get("/creation/{name}")
    async def asset(name: str):
        if name not in {"app.mjs", "ptt.mjs", "style.css"}:
            raise HTTPException(404, "파일을 찾을 수 없습니다.")
        return FileResponse(ROOT / "creation" / name,
                            media_type="text/javascript" if name.endswith(".mjs") else "text/css")

    return app


if __name__ == "__main__":
    import argparse
    import uvicorn
    parser = argparse.ArgumentParser(description="r1 연결 진단 서버를 실행합니다.")
    parser.add_argument("--port", type=int, default=8787, help="로컬 수신 포트를 지정합니다.")
    parser.add_argument("--origin", help="앱의 출처 주소를 지정합니다.")
    parser.add_argument("--tls-cert", help="진단용 TLS 인증서 파일을 지정합니다.")
    parser.add_argument("--tls-key", help="진단용 TLS 개인키 파일을 지정합니다.")
    parser.add_argument("--no-quota", action="store_true", help="프로토콜 시험에서 실제 계정 조회를 생략합니다.")
    args = parser.parse_args()
    public_origin = args.origin or os.environ.get("R1_PUBLIC_ORIGIN", f"http://127.0.0.1:{args.port}")
    from companion.quota import read_quota
    from companion.live import LiveMonitor
    expected_thread = '01a113d7-a337-75b1-871f-d4db4a3c36b7'
    app = create_app(public_origin, quota_reader=None if args.no_quota else read_quota,
                     live_monitor=None if args.no_quota else LiveMonitor(expected_thread))
    print(f"일회성 연결 코드: {app.state.pair_code} (2분 동안 유효합니다.)", flush=True)
    print("진단 앱 주소: " + public_origin, flush=True)
    print("진단 전용입니다. Codex 명령 전송은 차단되어 있습니다.", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, ws_max_size=8192,
                ssl_certfile=args.tls_cert, ssl_keyfile=args.tls_key)
