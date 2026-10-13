"""인증된 로컬 공유 서버를 관리하며 현재 독립 Codex를 종료하지 않습니다."""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import msvcrt
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
BINARY = Path(os.environ['LOCALAPPDATA']) / 'Programs/OpenAI/Codex/bin/codex.exe'
ENDPOINT = 'ws://127.0.0.1:4500'
TOKEN_PATH = RUNTIME / 'shared-token.txt'
STATE_PATH = RUNTIME / 'shared-server.json'


def write_token(path):
    """서버 전용 토큰이며 OpenAI 인증 토큰과 별개입니다."""
    token = secrets.token_urlsafe(32)
    path.write_text(token, encoding='utf-8')
    if os.name == 'nt':
        identity = os.environ['USERDOMAIN'] + '\\' + os.environ['USERNAME']
        subprocess.run(['icacls.exe', str(path), '/inheritance:r', '/grant:r', identity + ':(R,W)'],
                       check=True, capture_output=True)
    return token


def server_command(token_path):
    return [str(BINARY), 'app-server', '--listen', ENDPOINT,
            '--ws-auth', 'capability-token', '--ws-token-file', str(token_path)]


def resume_command(thread_id, cwd):
    """대화 ID는 명시적으로 지정하며 설정과 모델을 덮어쓰지 않습니다."""
    uuid.UUID(thread_id)
    return [str(BINARY), 'resume', thread_id, '--remote', ENDPOINT,
            '--remote-auth-token-env', 'R1_CODEX_SERVER_TOKEN', '-C', str(Path(cwd).resolve())]


def stop_process(process):
    """이 관리자가 시작한 프로세스만 종료합니다."""
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def server_ready():
    """저장된 상태와 실제 인증 연결을 함께 확인하며 대화나 모델 턴은 만들지 않습니다."""
    from websockets.sync.client import connect
    from websockets.exceptions import WebSocketException

    try:
        state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
        if not state.get('active') or state.get('phase') != 'ready' or state.get('endpoint') != ENDPOINT:
            return False
        token = TOKEN_PATH.read_text(encoding='utf-8').strip()
        with connect(ENDPOINT, additional_headers={'Authorization': 'Bearer ' + token},
                     proxy=None, open_timeout=2, close_timeout=1) as connection:
            connection.send(json.dumps({'id': 1, 'method': 'initialize', 'params': {
                'clientInfo': {'name': 'r1_handoff_check', 'version': '0.1.0'}}}))
            reply = json.loads(connection.recv(timeout=2))
            if reply.get('id') != 1 or 'result' not in reply or 'error' in reply:
                return False
            connection.send(json.dumps({'method': 'initialized'}))
            return True
    except (OSError, ValueError, TimeoutError, WebSocketException):
        return False


def run_server():
    """프로세스 종료 시 자동 해제되는 잠금으로 중복 실행과 오래된 상태를 구분합니다."""
    RUNTIME.mkdir(exist_ok=True)
    # 잠금 파일은 재사용하는 운영 자료이며 임시파일처럼 삭제하지 않습니다.
    with (RUNTIME / 'shared-server.lock').open('a+b') as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            raise RuntimeError('공유 서버 관리자가 이미 실행 중입니다.') from error
        _run_server()


def _run_server():
    """잠금을 보유한 관리자만 서버를 시작하고 해당 실행의 자료를 정리합니다."""
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', 4500)) == 0:
            raise RuntimeError('4500 포트를 다른 프로그램이 사용 중입니다.')
    write_token(TOKEN_PATH)
    temp_root = ROOT / '.project_tmp'
    temp_root.mkdir(exist_ok=True)
    state = {'active': True, 'phase': 'starting', 'endpoint': ENDPOINT,
             'sessionId': uuid.uuid4().hex, 'startedAt': datetime.now(timezone.utc).isoformat()}
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix='shared-server-', dir=temp_root) as directory, ExitStack() as stack:
            log = stack.enter_context((Path(directory) / 'server.log').open('w', encoding='utf-8'))
            env = dict(os.environ, TEMP=directory, TMP=directory)
            process = subprocess.Popen(server_command(TOKEN_PATH), cwd=ROOT, env=env,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            stack.callback(stop_process, process)
            state.update(pid=process.pid, supervisorPid=os.getpid(), runDirectory=directory)
            STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('공유 서버 시작에 실패했습니다.')
                with socket.socket() as probe:
                    if probe.connect_ex(('127.0.0.1', 4500)) == 0:
                        state['phase'] = 'ready'
                        STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
                        break
                time.sleep(0.2)
            else:
                raise TimeoutError('공유 서버 시작 대기 시간이 초과되었습니다.')
            # 작업 중인 세션이 있으므로 시간 제한으로 서버를 종료하지 않습니다.
            while process.poll() is None:
                time.sleep(1)
    except Exception as error:
        state['error'] = str(error)
        raise
    finally:
        if process is not None:
            stop_process(process)
        state.update(active=False, phase='stopped')
        STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='로컬 공유 Codex 서버를 실행합니다.')
    parser.add_argument('--check', action='store_true', help='실제 인증 연결 가능 여부만 확인합니다.')
    args = parser.parse_args()
    if args.check:
        raise SystemExit(0 if server_ready() else 1)
    run_server()
