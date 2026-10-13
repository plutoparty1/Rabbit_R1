"""설치 QR에 공개 정보만 포함하고 생성한 자식만 종료하는지 검증합니다."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from scripts.public_session import creation_payload, make_qr, request_control, run_session, stop_children

ROOT = Path(__file__).resolve().parents[1]


class PublicSessionTests(unittest.TestCase):
    def test_qr_contains_only_public_installation_fields(self):
        payload = creation_payload("https://unit-test.trycloudflare.com")
        self.assertEqual(set(payload), {"title", "url", "description", "iconUrl", "themeColor"})
        self.assertEqual(payload["url"], "https://unit-test.trycloudflare.com/")
        self.assertNotIn("token", json.dumps(payload))
        self.assertNotIn("pair", json.dumps(payload))

    def test_invalid_origin_is_rejected(self):
        for origin in ("http://unit-test.trycloudflare.com", "https://evil.example", "https://unit-test.trycloudflare.com/?token=secret", "https://user:secret@unit-test.trycloudflare.com"):
            with self.assertRaises(ValueError):
                creation_payload(origin)

    def test_qr_output_and_temporary_cleanup(self):
        temp = ROOT / ".project_tmp"
        temp.mkdir(exist_ok=True)
        before = set(temp.iterdir())
        with tempfile.TemporaryDirectory(prefix="qr-test-", dir=temp) as directory:
            make_qr("https://unit-test.trycloudflare.com", Path(directory))
            image = Path(directory) / "install-qr.png"
            self.assertEqual(image.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
            payload = json.loads((Path(directory) / "install-creation.json").read_text(encoding="utf-8"))
            self.assertEqual(payload, creation_payload("https://unit-test.trycloudflare.com"))
        self.assertEqual(set(temp.iterdir()), before)

    def test_only_owned_live_children_are_stopped(self):
        running, finished = Mock(), Mock()
        running.poll.return_value = None
        finished.poll.return_value = 0
        stop_children([running, finished])
        running.terminate.assert_called_once()
        running.wait.assert_called_once_with(timeout=5)
        finished.terminate.assert_not_called()

    def test_tunnel_url_alone_cannot_mark_session_ready(self):
        temp = ROOT / '.project_tmp'
        temp.mkdir(exist_ok=True)
        before = set(temp.iterdir())
        child = Mock(pid=123)
        child.poll.return_value = None
        with patch('scripts.public_session.STATE') as state, \
             patch('scripts.public_session.socket.socket') as connection, \
             patch('scripts.public_session.save_state'), \
             patch('scripts.public_session.make_qr'), \
             patch('scripts.public_session.subprocess.Popen', return_value=child), \
             patch('scripts.public_session.wait_log', side_effect=['https://unit-test.trycloudflare.com', 'Registered tunnel connection', '12345678']) as wait:
            state.exists.return_value = False
            connection.return_value.__enter__.return_value.connect_ex.return_value = 1
            run_session(minutes=0)
        self.assertTrue(any('Registered tunnel connection' in call.args[1] for call in wait.call_args_list))
        self.assertEqual(set(temp.iterdir()), before)

    def test_renew_control_waits_for_new_code(self):
        temp = ROOT / '.project_tmp'
        temp.mkdir(exist_ok=True)
        before = set(temp.iterdir())
        with tempfile.TemporaryDirectory(prefix='control-test-', dir=temp) as directory:
            directory = Path(directory)
            state_path = directory / 'state.json'
            state = {'active': True, 'sessionId': 'test-session', 'pairCode': '11111111'}
            state_path.write_text(json.dumps(state), encoding='utf-8')
            ended = threading.Event()
            def acknowledge():
                while not (directory / 'renew-pairing').exists():
                    if ended.wait(0.01):
                        return
                state['pairCode'] = '22222222'
                state_path.write_text(json.dumps(state), encoding='utf-8')
            thread = threading.Thread(target=acknowledge)
            thread.start()
            try:
                with patch('scripts.public_session.RUNTIME', directory), patch('scripts.public_session.STATE', state_path):
                    updated = request_control('renew-pairing', timeout=2)
                self.assertEqual(updated['pairCode'], '22222222')
            finally:
                ended.set()
                thread.join(timeout=2)
        self.assertEqual(set(temp.iterdir()), before)


if __name__ == "__main__":
    unittest.main()
