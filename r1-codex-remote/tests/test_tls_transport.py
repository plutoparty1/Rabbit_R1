"""자체 인증서를 신뢰하는 로컬 클라이언트로 실제 HTTPS/WSS를 검증합니다."""
import asyncio
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from websockets.asyncio.client import connect

ROOT = Path(__file__).resolve().parents[1]
OPENSSL = Path("C:/Program Files/Git/usr/bin/openssl.exe")


class TransportTests(unittest.TestCase):
    @unittest.skipUnless(OPENSSL.exists(), "로컬 TLS 검증용 OpenSSL이 없습니다.")
    def test_real_https_wss_and_temporary_cleanup(self):
        temp_root = ROOT / ".project_tmp"
        temp_root.mkdir(exist_ok=True)
        before = set(temp_root.iterdir())
        with tempfile.TemporaryDirectory(prefix="tls-", dir=temp_root) as directory:
            key, cert = Path(directory) / "key.pem", Path(directory) / "cert.pem"
            env = dict(os.environ, TEMP=directory, TMP=directory, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
            subprocess.run([str(OPENSSL), "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                            "-keyout", str(key), "-out", str(cert), "-subj", "/CN=127.0.0.1",
                            "-addext", "subjectAltName=IP:127.0.0.1"],
                           env=env, capture_output=True, check=True, timeout=15)
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            origin = f"https://127.0.0.1:{port}"
            server = subprocess.Popen([sys.executable, "-m", "companion.server", "--port", str(port),
                                       "--origin", origin, "--tls-cert", str(cert), "--tls-key", str(key), "--no-quota"],
                                      cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                      text=True, encoding="utf-8")
            try:
                code = re.search(r"\b\d{8}\b", server.stdout.readline()).group()
                context = ssl.create_default_context(cafile=str(cert))
                for _ in range(50):
                    try:
                        with urllib.request.urlopen(origin, context=context, timeout=0.3) as response:
                            self.assertEqual(response.status, 200)
                        break
                    except OSError:
                        time.sleep(0.05)
                else:
                    self.fail("HTTPS 진단 서버가 준비되지 않았습니다.")
                request = urllib.request.Request(origin + "/api/pair", json.dumps({"code": code}).encode("utf-8"),
                                                 {"Origin": origin, "Content-Type": "application/json"})
                with urllib.request.urlopen(request, context=context, timeout=3) as response:
                    cookie = response.headers["Set-Cookie"].split(";", 1)[0]
                    self.assertIn("Secure", response.headers["Set-Cookie"])
                    self.assertTrue(json.load(response)["paired"])

                async def receive():
                    async with connect(f"wss://127.0.0.1:{port}/api/events", ssl=context, origin=origin,
                                       additional_headers={"Cookie": cookie}, proxy=None) as ws:
                        event = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
                        self.assertEqual(event["kind"], "diagnostic.snapshot")
                        self.assertFalse(event["state"]["codex"]["sameServerSameThreadProven"])
                asyncio.run(receive())
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)
                server.stdout.close()
        self.assertEqual(set(temp_root.iterdir()), before)


if __name__ == "__main__":
    unittest.main()
