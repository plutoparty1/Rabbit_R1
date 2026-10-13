"""승인된 진단 앱만 일시 공개하고 자신이 실행한 프로세스를 정리합니다."""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
import uuid

import qrcode

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"
STATE = RUNTIME / "public-state.json"
CLOUDFLARED = ROOT / ".tools" / "cloudflared-2026.10.0.exe"
CLOUDFLARE_CA = ROOT / ".tools" / "cloudflare-edge-ca-2026.10.0.pem"


def creation_payload(origin):
    """QR에는 공개 설치 정보만 담습니다. 연결 코드와 토큰은 포함하지 않습니다."""
    if not re.fullmatch(r"https://[a-z0-9-]+\.trycloudflare\.com", origin):
        raise ValueError("검증된 임시 HTTPS 출처가 필요합니다.")
    return {"title": "R1 Codex 연결 진단", "url": origin + "/",
            "description": "Codex 계정 잔여 한도 상태창입니다. 세션 제어와 음성 전송은 검증 전 차단됩니다.",
            "iconUrl": "", "themeColor": "#FE5000"}


def make_qr(origin, directory):
    payload = creation_payload(origin)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    directory.mkdir(parents=True, exist_ok=True)
    # 설치 이미지와 공개 메타데이터는 사용자 산출물이므로 실행 종료 때 삭제하지 않습니다.
    (directory / "install-creation.json").write_text(text, encoding="utf-8")
    qrcode.make(text, box_size=8, border=4).save(directory / "install-qr.png")


def stop_children(children):
    """외부 PID를 받지 않고 이번 실행에서 얻은 Popen 객체만 종료합니다."""
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)


def timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def save_state(state):
    RUNTIME.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    # 공개 보고서에는 코드, 로그 경로, 기기 자격 증명을 기록하지 않습니다.
    public = {key: state.get(key) for key in ("sessionId", "active", "phase", "url", "startedAt", "expiresAt", "stoppedAt", "error")}
    public.update(sameServerSameThreadProven=False, commandDeliveryEnabled=False, realR1Test="not_verified")
    (ROOT / "docs" / "public-session.json").write_text(json.dumps(public, ensure_ascii=False, indent=2), encoding="utf-8")


def wait_log(path, pattern, child, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = re.search(pattern, path.read_text(encoding="utf-8", errors="replace"))
        if found:
            return found.group(1)
        if child.poll() is not None:
            raise RuntimeError("진단 연결 프로세스가 시작 중 종료되었습니다.")
        time.sleep(0.2)
    raise TimeoutError("진단 연결 시작 대기 시간이 초과되었습니다.")


def request_control(action, timeout=15):
    """코드 갱신과 종료 요청은 실제 완료 상태를 확인한 뒤 반환합니다."""
    if action not in {'stop-public', 'renew-pairing'}:
        raise ValueError('지원하지 않는 진단 제어입니다.')
    previous = json.loads(STATE.read_text(encoding='utf-8'))
    if not previous.get('active'):
        raise RuntimeError('실행 중인 진단 연결이 없습니다.')
    (RUNTIME / action).write_text(previous['sessionId'], encoding='utf-8')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            current = json.loads(STATE.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            time.sleep(0.05)
            continue
        if current['sessionId'] != previous['sessionId']:
            raise RuntimeError('진단 실행이 변경되었습니다. 새 상태를 확인해 주세요.')
        if action == 'stop-public' and not current.get('active'):
            return current
        if action == 'renew-pairing' and current.get('active') and current.get('pairCode') != previous.get('pairCode'):
            return current
        time.sleep(0.05)
    raise TimeoutError('진단 제어 완료를 확인하지 못했습니다.')


def run_session(minutes=60):
    if STATE.exists() and json.loads(STATE.read_text(encoding="utf-8")).get("active"):
        raise RuntimeError("진단 연결이 이미 실행 중입니다.")
    if not CLOUDFLARED.exists():
        raise FileNotFoundError("검증된 프로젝트용 cloudflared가 없습니다.")
    if not CLOUDFLARE_CA.exists():
        raise FileNotFoundError("공식 Cloudflare 서버 인증서 목록이 없습니다.")
    with socket.socket() as check:
        if check.connect_ex(("127.0.0.1", 8787)) == 0:
            raise RuntimeError("8787 포트를 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료하지 않습니다.")
    temp_root = ROOT / ".project_tmp"
    temp_root.mkdir(exist_ok=True)
    started = time.time()
    state = {"sessionId": uuid.uuid4().hex, "active": True, "phase": "starting", "supervisorPid": os.getpid(),
             "startedAt": timestamp(started), "expiresAt": timestamp(started + minutes * 60)}
    children = []
    save_state(state)
    try:
        with tempfile.TemporaryDirectory(prefix="public-", dir=temp_root) as directory, ExitStack() as stack:
            directory = Path(directory)
            state["runDirectory"] = str(directory)
            env = dict(os.environ, TEMP=str(directory), TMP=str(directory), PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
            def launch(command, name):
                path = directory / (name + ".log")
                output = stack.enter_context(path.open("w", encoding="utf-8"))
                child = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                         stdout=output, stderr=output,
                                         creationflags=subprocess.CREATE_NO_WINDOW)
                children.append(child)
                return child, path

            try:
                # Windows 저장소 경로 대신 배포본과 같은 공식 CA를 지정하며 TLS 검증은 유지합니다.
                tunnel, log = launch([str(CLOUDFLARED), "--no-autoupdate", "tunnel", "--cacert", str(CLOUDFLARE_CA), "--url", "http://127.0.0.1:8787",
                                      "--protocol", "http2", "--metrics", "127.0.0.1:0"], "tunnel")
                state["tunnelPid"] = tunnel.pid
                state["url"] = wait_log(log, r"(https://[a-z0-9-]+\.trycloudflare\.com)", tunnel)
                creation_payload(state["url"])
                # 주소 발급만으로 성공 처리하지 않고 실제 Edge 등록을 먼저 기다립니다.
                wait_log(log, r"(Registered tunnel connection)", tunnel)
                make_qr(state["url"], ROOT / "docs")

                def start_bridge():
                    bridge, log = launch([sys.executable, "-m", "companion.server", "--origin", state["url"]], "bridge-" + uuid.uuid4().hex)
                    code = wait_log(log, r"일회성 연결 코드: (\d{8})", bridge, timeout=15)
                    state.update(bridgePid=bridge.pid, pairCode=code, pairExpiresAt=timestamp(time.time() + 120))
                    return bridge

                bridge = start_bridge()
                state["phase"] = "ready"
                save_state(state)
                print("임시 진단 연결이 준비되었습니다.", flush=True)
                while time.time() < started + minutes * 60:
                    stop = RUNTIME / "stop-public"
                    if stop.exists() and stop.read_text(encoding="utf-8") == state["sessionId"]:
                        stop.unlink()
                        break
                    renew = RUNTIME / "renew-pairing"
                    if renew.exists() and renew.read_text(encoding="utf-8") == state["sessionId"]:
                        renew.unlink()
                        stop_children([bridge])
                        bridge = start_bridge()
                        save_state(state)
                    if tunnel.poll() is not None or bridge.poll() is not None:
                        raise RuntimeError("진단 연결이 끊겨 공개 통로를 종료합니다.")
                    time.sleep(0.5)
            finally:
                # 파일 핸들을 닫고 임시 폴더를 지우기 전에 소유한 자식을 먼저 종료합니다.
                stop_children(children)
    except Exception as error:
        state["error"] = str(error)
        raise
    finally:
        state.update(active=False, phase="stopped", stoppedAt=timestamp(time.time()))
        state.pop("pairCode", None)
        save_state(state)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="승인된 r1 시험용 연결을 관리합니다.")
    parser.add_argument("--minutes", type=int, default=60, choices=range(1, 61), metavar="1~60", help="자동 종료 시간을 분 단위로 지정합니다.")
    controls = parser.add_mutually_exclusive_group()
    controls.add_argument("--stop", action="store_true", help="현재 시험용 통로만 종료합니다.")
    controls.add_argument("--renew-code", action="store_true", help="진단 서버를 재시작하여 기기 연결 코드를 갱신합니다.")
    args = parser.parse_args()
    if args.stop or args.renew_code:
        request_control("stop-public" if args.stop else "renew-pairing")
    else:
        run_session(args.minutes)
