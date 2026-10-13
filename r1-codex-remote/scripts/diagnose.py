"""기존 실행과 설정을 읽고 설치 버전의 프로토콜을 기록합니다."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CODEX = Path(os.environ["LOCALAPPDATA"]) / "Programs/OpenAI/Codex/bin/codex.exe"
HOME = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))


def run(args):
    result = subprocess.run(args, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=30)
    return {"exitCode": result.returncode, "output": (result.stdout + result.stderr).strip()}


def fingerprints():
    # 파일 내용은 저장하지 않으며 변경 여부 확인용 해시만 남깁니다.
    return {name: hashlib.sha256((HOME / name).read_bytes()).hexdigest()
            for name in ("config.toml", "auth.json") if (HOME / name).exists()}


def diagnose():
    before = fingerprints()
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "binary": str(CODEX),
              "codexHome": str(HOME), "cwd": str(ROOT.parent),
              "currentThreadId": os.environ.get("CODEX_THREAD_ID"),
              "version": run([str(CODEX), "--version"]),
              "login": run([str(CODEX), "login", "status"]),
              "daemonVersion": run([str(CODEX), "app-server", "daemon", "version"]),
              "sameServerSameThreadProven": False, "commandDeliveryEnabled": False,
              "fingerprintsBefore": before}
    command = """[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $p=Get-CimInstance Win32_Process | Where-Object Name -eq 'codex.exe'; $p | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId; parentPid=$_.ParentProcessId; binary=$_.ExecutablePath; noDaemon=($_.CommandLine -match '--no-daemon'); appServer=($_.CommandLine -match 'app-server'); remote=($_.CommandLine -match '--remote'); listener=[regex]::Match($_.CommandLine,'--listen\\s+(ws://127\\.0\\.0\\.1:[0-9]+|stdio://|off)').Groups[1].Value} } | ConvertTo-Json -Compress"""
    process = run(["powershell.exe", "-NoProfile", "-Command", command])
    report["processes"] = json.loads(process["output"] or "[]") if process["exitCode"] == 0 else []
    temp_root = ROOT / ".project_tmp"
    temp_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="schema-", dir=temp_root) as directory:
        env = dict(os.environ, TEMP=directory, TMP=directory)
        result = subprocess.run([str(CODEX), "app-server", "generate-json-schema", "--experimental", "--out", directory],
                                env=env, capture_output=True, timeout=30)
        report["schemaGenerationExitCode"] = result.returncode
        wanted = {"InitializeParams", "InitializeResponse", "ThreadLoadedListParams", "ThreadLoadedListResponse",
                  "ThreadReadParams", "TurnStartParams", "TurnSteerParams", "GetAccountRateLimitsResponse",
                  "GetAccountTokenUsageResponse", "ThreadTokenUsageUpdatedNotification"}
        schemas = {}
        for path in Path(directory).rglob("*.json"):
            if path.stem in wanted:
                data = json.loads(path.read_text(encoding="utf-8"))
                schemas[path.stem] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                     "required": data.get("required", []),
                                     "properties": list(data.get("properties", {}))}
        report["schemas"] = schemas
        # 실제 ClientRequest의 열거형에서 메서드 이름을 수집합니다.
        methods = set()
        def visit(value):
            if isinstance(value, dict):
                method = value.get("properties", {}).get("method", {})
                if "const" in method:
                    methods.add(method["const"])
                methods.update(method.get("enum", []))
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
        for path in Path(directory).rglob("*ClientRequest*.json"):
            visit(json.loads(path.read_text(encoding="utf-8")))
        report["selectedMethods"] = sorted(m for m in methods if m.startswith(("account/", "thread/loaded/", "turn/")))
    report["fingerprintsAfter"] = fingerprints()
    report["settingsUnchanged"] = before == report["fingerprintsAfter"]
    return report


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    output = ROOT / "docs" / "environment.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(diagnose(), ensure_ascii=False, indent=2), encoding="utf-8")
    print("진단 보고서가 저장되었습니다.")
