"""외부 접근 차단과 진단 단계의 Codex 전송 금지를 검증합니다."""
import unittest
import time
import asyncio
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from companion.server import create_app

ORIGIN = "http://127.0.0.1:8787"


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(origin=ORIGIN)
        self.client = TestClient(self.app, base_url=ORIGIN)
        self.headers = {"Origin": ORIGIN}

    def pair(self):
        return self.client.post("/api/pair", json={"code": self.app.state.pair_code}, headers=self.headers)

    def test_unpaired_cannot_read_or_write(self):
        self.assertEqual(self.client.get("/api/state").status_code, 401)
        self.assertEqual(self.client.post("/api/diagnostic/ping", json={}, headers=self.headers).status_code, 401)

    def test_pair_is_one_use_and_state_never_claims_live_codex(self):
        self.assertEqual(self.pair().status_code, 200)
        self.assertEqual(self.pair().status_code, 403)
        state = self.client.get("/api/state").json()
        self.assertFalse(state["codex"]["sameServerSameThreadProven"])
        self.assertFalse(state["codex"]["commandDeliveryEnabled"])
        self.assertIsNone(state["codex"]["tokens"])

    def test_expired_code_and_cross_origin_rejected(self):
        self.assertEqual(self.client.post("/api/pair", json={"code": self.app.state.pair_code}, headers={"Origin": "https://evil.example"}).status_code, 403)
        self.app.state.pair_expires = 0
        self.assertEqual(self.pair().status_code, 403)

    def test_missing_origin_large_body_and_unknown_fields_rejected(self):
        self.assertEqual(self.client.post("/api/pair", json={"code": "123456"}).status_code, 403)
        self.assertEqual(self.client.post("/api/pair", content="x" * 8193, headers=self.headers).status_code, 413)
        self.assertEqual(self.pair().status_code, 200)
        self.assertEqual(self.client.post("/api/diagnostic/ping", json={"requestId": "test", "shell": "whoami"}, headers=self.headers).status_code, 422)

    def test_revoked_device_loses_http_and_websocket_access(self):
        self.assertEqual(self.pair().status_code, 200)
        self.app.state.devices.clear()
        self.assertEqual(self.client.get("/api/state").status_code, 401)
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("ws://127.0.0.1:8787/api/events", headers=self.headers) as ws:
                ws.receive_json()

    def test_ping_and_websocket_are_explicit_diagnostic_data(self):
        self.assertEqual(self.pair().status_code, 200)
        result = self.client.post("/api/diagnostic/ping", json={"requestId": "한글-시험"}, headers=self.headers).json()
        self.assertEqual(result["requestId"], "한글-시험")
        self.assertEqual(result["kind"], "diagnostic.echo")
        with self.client.websocket_connect("ws://127.0.0.1:8787/api/events", headers=self.headers) as ws:
            event = ws.receive_json()
            self.assertEqual(event["kind"], "diagnostic.snapshot")
            self.assertFalse(event["state"]["codex"]["sameServerSameThreadProven"])
        self.assertEqual(self.client.post("/api/commands", json={"text": "보내지 마세요."}, headers=self.headers).status_code, 409)

    def test_host_validation_and_rate_limit(self):
        self.assertEqual(self.client.get("/api/state", headers={"Host": "evil.example"}).status_code, 403)
        for _ in range(10):
            self.client.post("/api/pair", json={"code": "wrong"}, headers=self.headers)
        self.assertEqual(self.pair().status_code, 429)

    def test_live_quota_is_separate_from_unverified_session_status(self):
        quota = {'status': 'ready', 'windows': [{'remainingPercent': 64, 'windowDurationMins': 10080,
                                                'resetsAt': 1791601842}], 'checkedAt': '2026-10-07T03:00:00Z',
                 'sourceScope': 'account_only', 'sameServerSameThreadProven': False}
        app = create_app(origin=ORIGIN, quota_reader=lambda: quota)
        with TestClient(app, base_url=ORIGIN) as client:
            self.assertEqual(client.post('/api/pair', json={'code': app.state.pair_code}, headers=self.headers).status_code, 200)
            for _ in range(50):
                state = client.get('/api/state').json()
                if state['quota']['status'] == 'ready':
                    break
                time.sleep(0.01)
            self.assertEqual(state['quota']['windows'][0]['remainingPercent'], 64)
            self.assertIsNone(state['sessions'])
            self.assertFalse(state['codex']['sameServerSameThreadProven'])

    def test_shared_events_are_visible_but_voice_commands_remain_blocked(self):
        class Monitor:
            async def run(self):
                await asyncio.Event().wait()
            def snapshot(self):
                return {'connected': True, 'sameServerSameThreadProven': False,
                        'sessions': [{'id': 'test-thread', 'name': '전용 시험', 'status': '처리 중', 'reply': '실시간 시험'}]}
        app = create_app(origin=ORIGIN, live_monitor=Monitor())
        with TestClient(app, base_url=ORIGIN) as client:
            client.post('/api/pair', json={'code': app.state.pair_code}, headers=self.headers)
            state = client.get('/api/state').json()
            self.assertEqual(state['sessions'][0]['reply'], '실시간 시험')
            self.assertFalse(state['codex']['sameServerSameThreadProven'])
            self.assertEqual(client.post('/api/commands', json={'text': '음성'}, headers=self.headers).status_code, 409)


if __name__ == "__main__":
    unittest.main()
