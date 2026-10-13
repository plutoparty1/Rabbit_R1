"""계정 한도만 읽으며 대화 생성·재개·모델 턴을 실행하지 않습니다."""
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def normalize_quota(response):
    """다른 모델 버킷과 크레딧을 Codex 사용 창에 합산하지 않습니다."""
    response = response or {}
    buckets = response.get('rateLimitsByLimitId') or {}
    bucket = buckets.get('codex') or response.get('rateLimits') or {}
    if bucket.get('limitId') not in (None, 'codex'):
        bucket = {}
    windows = []
    for name in ('primary', 'secondary'):
        window = bucket.get(name)
        if not isinstance(window, dict):
            continue
        used = window.get('usedPercent')
        valid = type(used) in (int, float) and math.isfinite(used) and 0 <= used <= 100
        minutes = window.get('windowDurationMins')
        resets = window.get('resetsAt')
        windows.append({'id': name, 'remainingPercent': 100 - used if valid else None,
                        'windowDurationMins': minutes if type(minutes) is int and minutes > 0 else None,
                        'resetsAt': resets if type(resets) is int and resets > 0 else None})
    return {'status': 'ready' if any(w['remainingPercent'] is not None for w in windows) else 'unavailable',
            'windows': windows, 'checkedAt': datetime.now(timezone.utc).isoformat(),
            'source': 'account/rateLimits/read', 'sourceScope': 'account_only',
            'sameServerSameThreadProven': False, 'modelTurnsStarted': 0}


def read_quota():
    """기존 인증을 읽기 전용의 별도 프로세스에서 이용합니다."""
    temp_root = ROOT / '.project_tmp'
    candidate = Path(os.environ.get('TEMP', str(temp_root))).resolve()
    if candidate.is_relative_to(temp_root.resolve()):
        # 브리지 관리자의 실행 폴더 안에 두어 강제 종료 때도 관리자가 정리합니다.
        temp_root = candidate
    temp_root.mkdir(exist_ok=True)
    binary = Path(os.environ['LOCALAPPDATA']) / 'Programs/OpenAI/Codex/bin/codex.exe'
    with tempfile.TemporaryDirectory(prefix='quota-', dir=temp_root) as directory:
        env = dict(os.environ, TEMP=directory, TMP=directory)
        process = subprocess.Popen([str(binary), 'app-server', '--listen', 'stdio://'],
                                   cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        messages = queue.Queue()
        def receive():
            for line in process.stdout:
                try:
                    messages.put(json.loads(line))
                except json.JSONDecodeError:
                    pass
            messages.put(None)
        reader = threading.Thread(target=receive, daemon=True)
        reader.start()
        deadline = time.monotonic() + 25
        def request(number, method, params=None):
            process.stdin.write(json.dumps({'id': number, 'method': method, 'params': params or {}}) + '\n')
            process.stdin.flush()
            while time.monotonic() < deadline:
                item = messages.get(timeout=max(0.1, deadline - time.monotonic()))
                if item is None:
                    raise RuntimeError('계정 조회 연결이 종료되었습니다.')
                if item.get('id') == number:
                    if 'error' in item:
                        raise RuntimeError('계정 한도를 조회하지 못했습니다.')
                    return item['result']
            raise TimeoutError('계정 조회 시간이 초과되었습니다.')
        try:
            request(1, 'initialize', {'clientInfo': {'name': 'r1_account_readonly', 'title': 'R1 계정 한도 조회', 'version': '0.1.0'}})
            process.stdin.write(json.dumps({'method': 'initialized'}) + '\n')
            process.stdin.flush()
            account = request(2, 'account/read', {'refreshToken': False})
            if (account.get('account') or {}).get('type') != 'chatgpt':
                result = normalize_quota(None)
                result['reason'] = 'ChatGPT 계정의 한도가 제공되지 않습니다.'
                return result
            return normalize_quota(request(3, 'account/rateLimits/read'))
        except (OSError, RuntimeError, TimeoutError, queue.Empty):
            result = normalize_quota(None)
            result['reason'] = '계정 한도를 조회하지 못했습니다. 잠시 후 다시 확인합니다.'
            return result
        finally:
            try:
                process.stdin.close()
            except OSError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            reader.join(timeout=2)
            process.stdout.close()
