"""전송 자격 증명과 원래 대화 재개 인자가 안전하게 제한되는지 확인합니다."""
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import shared_server
from scripts.shared_server import server_command, resume_command, write_token

ROOT = Path(__file__).resolve().parents[1]
THREAD = '01a113d7-a337-75b1-871f-d4db4a3c36b7'


class SharedServerTests(unittest.TestCase):
    def test_stale_ready_state_does_not_prevent_restart(self):
        # 종료된 실행의 상태 파일이 남아 있어도 새 서버를 시작하고 임시 자료를 정리합니다.
        temp = ROOT / '.project_tmp'
        temp.mkdir(exist_ok=True)
        before = set(temp.iterdir())
        with tempfile.TemporaryDirectory(prefix='restart-test-', dir=temp) as directory:
            root = Path(directory)
            runtime = root / '.runtime'
            runtime.mkdir()
            state = runtime / 'shared-server.json'
            state.write_text(json.dumps({'active': True, 'phase': 'ready', 'pid': 999999}), encoding='utf-8')
            child = Mock(pid=123)
            child.poll.side_effect = [None, 0, 0, 0]
            with patch.multiple(shared_server, ROOT=root, RUNTIME=runtime, STATE_PATH=state,
                                TOKEN_PATH=runtime / 'token.txt'), \
                    patch.object(shared_server.socket, 'socket') as probe, \
                    patch.object(shared_server.subprocess, 'Popen', return_value=child) as launch, \
                    patch.object(shared_server, 'write_token'):
                probe.return_value.__enter__.return_value.connect_ex.side_effect = [1, 0]
                shared_server.run_server()
            launch.assert_called_once()
            self.assertEqual(json.loads(state.read_text(encoding='utf-8'))['pid'], 123)
            self.assertFalse(json.loads(state.read_text(encoding='utf-8'))['active'])
            self.assertEqual(list((root / '.project_tmp').iterdir()), [])
        self.assertEqual(set(temp.iterdir()), before)

    def test_ready_requires_live_authenticated_response(self):
        # 저장된 ready 표시만으로는 준비 완료가 아니며 실제 인증 응답이 필요합니다.
        state = Mock()
        state.read_text.return_value = json.dumps({'active': True, 'phase': 'ready',
                                                  'endpoint': shared_server.ENDPOINT})
        token = Mock()
        token.read_text.return_value = 'test-local-token'
        with patch.object(shared_server, 'STATE_PATH', state), \
                patch.object(shared_server, 'TOKEN_PATH', token), \
                patch('websockets.sync.client.connect') as connect:
            connection = connect.return_value.__enter__.return_value
            for reply, expected in (({'id': 1, 'result': {}}, True),
                                    ({'id': 1, 'error': {'message': 'denied'}}, False)):
                connection.recv.return_value = json.dumps(reply)
                self.assertEqual(shared_server.server_ready(), expected)
            connect.side_effect = ConnectionRefusedError()
            self.assertFalse(shared_server.server_ready())
            self.assertEqual(connect.call_args.kwargs['additional_headers'],
                             {'Authorization': 'Bearer test-local-token'})

    def test_live_supervisor_and_occupied_port_are_not_replaced(self):
        # 관리자가 시작 중이거나 다른 프로그램이 포트를 사용하면 토큰을 바꾸지 않습니다.
        temp = ROOT / '.project_tmp'
        temp.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='lock-test-', dir=temp) as directory:
            runtime = Path(directory)
            with patch.object(shared_server, 'RUNTIME', runtime), \
                    patch.object(shared_server.socket, 'socket') as probe, \
                    patch.object(shared_server, 'write_token') as token:
                with (runtime / 'shared-server.lock').open('a+b') as lock:
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                    with self.assertRaisesRegex(RuntimeError, '관리자가 이미'):
                        shared_server.run_server()
                probe.return_value.__enter__.return_value.connect_ex.return_value = 0
                with self.assertRaisesRegex(RuntimeError, '4500 포트'):
                    shared_server.run_server()
                token.assert_not_called()

    def test_handoff_recovers_before_resuming_exact_thread(self):
        # 실제 PowerShell 제어 흐름을 실행하되 서버와 Codex 실행만 시험 함수로 바꿉니다.
        harness = r'''
$ErrorActionPreference = 'Stop'
$script:events = [Collections.Generic.List[string]]::new()
$script:checks = 0
function Join-Path($Path, $ChildPath) {
    if ($ChildPath -eq '.venv\Scripts\python.exe') { return 'Test-Python' }
    if ($ChildPath -eq 'Programs\OpenAI\Codex\bin\codex.exe') { return 'Test-Codex' }
    Microsoft.PowerShell.Management\Join-Path $Path $ChildPath
}
function Test-Python {
    $script:events.Add('check')
    $script:checks++
    $global:LASTEXITCODE = if ($script:checks -eq 1) { 1 } else { 0 }
}
function Start-Process {
    $script:events.Add('start')
    [pscustomobject]@{ HasExited = $false }
}
function Start-Sleep {}
function Test-Codex {
    $script:events.Add('resume')
    $script:resumeArgs = @($args)
    $global:LASTEXITCODE = 0
}
function Get-Content {
    '{"active":true,"phase":"ready","endpoint":"ws://127.0.0.1:4500"}'
}
$source = [IO.File]::ReadAllText($env:R1_TEST_SCRIPT, [Text.Encoding]::UTF8)
$source = $source.Replace('$PSScriptRoot', '(Microsoft.PowerShell.Management\Split-Path -Parent $env:R1_TEST_SCRIPT)')
# 시험 전용 토큰을 사용하여 실제 자격 증명을 읽지 않습니다.
$source = $source.Replace('[IO.File]::ReadAllText($taskTokenPath, [Text.Encoding]::UTF8).Trim()', "'test-token'")
$env:R1_CODEX_SERVER_TOKEN = 'previous-test-value'
& ([scriptblock]::Create($source)) -ThreadId $env:R1_TEST_THREAD -WorkingDirectory $env:R1_TEST_CWD -OriginalProcessId 0
if ($env:R1_CODEX_SERVER_TOKEN -ne 'previous-test-value') { throw '토큰 환경변수가 복원되지 않았습니다.' }
@{ events = @($script:events); resumeArgs = $script:resumeArgs } | ConvertTo-Json -Compress
'''
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', harness],
                                env=dict(os.environ, R1_TEST_SCRIPT=str(ROOT / 'scripts/resume-shared.ps1'),
                                         R1_TEST_THREAD=THREAD, R1_TEST_CWD=str(ROOT.parent)),
                                capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
        output = json.loads(result.stdout.decode('utf-8', errors='replace').splitlines()[-1])
        self.assertEqual(output['events'], ['check', 'start', 'check', 'resume'])
        self.assertEqual(output['resumeArgs'][:4], ['resume', THREAD, '--remote', shared_server.ENDPOINT])

    def test_secret_is_in_file_and_never_server_arguments(self):
        temp = ROOT / '.project_tmp'
        temp.mkdir(exist_ok=True)
        before = set(temp.iterdir())
        with tempfile.TemporaryDirectory(prefix='shared-test-', dir=temp) as directory:
            path = Path(directory) / 'token.txt'
            token = write_token(path)
            self.assertGreaterEqual(len(token), 40)
            command = server_command(path)
            self.assertNotIn(token, ' '.join(command))
            self.assertIn('ws://127.0.0.1:4500', command)
            self.assertIn('capability-token', command)
            self.assertNotIn('--model', command)
            self.assertNotIn('--sandbox', command)
        self.assertEqual(set(temp.iterdir()), before)

    def test_resume_has_exact_thread_and_no_last_or_new_prompt(self):
        command = resume_command(THREAD, str(ROOT.parent))
        self.assertIn(THREAD, command)
        self.assertIn('resume', command)
        self.assertIn('--remote', command)
        self.assertNotIn('--last', command)
        self.assertNotIn('--model', command)
        self.assertEqual(command[-1], str(ROOT.parent))

    def test_invalid_thread_id_is_rejected(self):
        with self.assertRaises(ValueError):
            resume_command('--last', str(ROOT.parent))

    def test_windows_handoff_script_preserves_korean_defaults(self):
        # Windows PowerShell 5.1은 BOM 없는 UTF-8 스크립트를 기존 코드 페이지로 읽습니다.
        script = (ROOT / 'scripts/resume-shared.ps1').read_bytes()
        self.assertTrue(script.startswith(b'\xef\xbb\xbf'), '한글 경로 보존을 위해 UTF-8 BOM이 필요합니다.')
        self.assertIn(str(ROOT.parent), script.decode('utf-8-sig'))


if __name__ == '__main__':
    unittest.main()
