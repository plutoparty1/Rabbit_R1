# 환경 및 연결 가능성 보고서

진단일: 2026-10-07. 원본 명세: `C:\Users\정산-PC\Downloads\R1_Codex_Remote_개발명세.md`.

## 판정

**현재 실행 중인 Codex 대화에 연결하지 못했습니다. 단계 A의 환경 조사는 완료했으나 연결 증명은 미완료입니다.** 저장 대화 읽기나 새 대화 생성으로 성공을 대체하지 않았습니다.

## 직접 확인한 사실

- 실행 파일: `C:\Users\정산-PC\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`.
- `Get-Command codex`는 PowerShell 함수가 먼저 선택됩니다. 실제 Application 경로와 버전도 별도로 확인했습니다.
- `codex --version`: `codex-cli 0.160.1`.
- `codex login status`: `Logged in using ChatGPT`. 계정 비밀값은 출력하거나 복사하지 않았습니다.
- `CODEX_HOME` 환경변수 없음. 기본 경로 `C:\Users\정산-PC\.codex` 사용.
- 실행 프로세스 PID `37572`, 부모 `25512`, 실행 인자에 `--no-daemon` 존재. `--remote`·`app-server`·`--listen` 없음. 해당 프로세스의 TCP 수신 포트 없음.
- 현재 환경의 `CODEX_THREAD_ID`: `01a113d7-a337-75b1-871f-d4db4a3c36b7`. 환경변수의 ID만 확인했습니다. 서버에서 loaded 상태를 확인한 값이 아닙니다.
- `codex app-server daemon version` 실패: `failed to connect to ...app-server-control.sock`, `os error 10050`.
- `daemon.lock`·`daemon.pid.lock` 파일은 있지만, 파일 존재를 서버 실행 성공으로 해석하지 않았습니다.
- `daemon status`는 설치 버전에 없는 명령입니다. 도움말 확인 후 지원되는 `daemon version`으로 조회했습니다.
- `config.toml`과 `auth.json` 해시는 진단 전후 동일합니다. 값과 해시는 [environment.json](environment.json)에 기록했습니다. 원본 설정 내용과 인증 토큰은 보고서에 넣지 않았습니다.

## 연결에 대한 결론과 한계

현재 TUI는 공유 daemon을 사용하지 않습니다. 조사한 지원 인터페이스에서 해당 프로세스에 다른 클라이언트가 붙을 수 있는 주소를 찾지 못했습니다. daemon 연결 오류의 원인을 확정하지 않았으며 Windows 소켓·설치·네트워크 환경을 수정하지 않았습니다. 이 결과를 ‘PC 전체에 Codex 작업이 없다’고 해석하지 않습니다.

안전한 다음 방법은 현재 턴이 끝난 뒤, 승인받은 공유 서버에서 **같은 대화 ID**를 이어받는 것입니다. 이것은 현재 프로세스에 연결하는 것과 다르므로 [인계안](session-handoff.md)에서 구분했습니다.

## 설치 버전의 프로토콜 확인

`codex --help`, `app-server --help`, `resume --help`, `app-server proxy --help`, `daemon --help`, 스키마 생성 도움말을 읽었습니다. `generate-json-schema --experimental`을 프로젝트 임시 폴더에서 실행하고 정리했습니다. 생성 exit code는 0입니다.

실제 스키마에서 다음을 확인했습니다.

- `initialize`: `clientInfo` 필수. 응답 필드는 `codexHome`, `platformFamily`, `platformOs`, `userAgent`.
- `thread/loaded/list`: `data` 필수, `nextCursor` 제공. loaded 목록의 비어 있음만으로 PC 전체 작업 부재를 판정하지 않습니다.
- `thread/read`: `threadId` 필수. 이 API는 저장 이력 조회만으로 이벤트 구독을 증명하지 않습니다.
- `turn/start`: `threadId`, `input` 필수.
- `turn/steer`: `threadId`, `expectedTurnId`, `input` 필수.
- `account/read`, `account/rateLimits/read`, `account/usage/read` 메서드 존재.
- `thread/tokenUsage/updated`: `threadId`, `turnId`, `tokenUsage` 필수.

이는 설치된 프로토콜의 지원 확인입니다. 해당 메서드를 실행 중인 서버에서 호출한 증거가 아닙니다. 실제 사용량·계정 한도·이벤트 응답은 아직 받지 않았습니다. 보고서에 가짜 수치를 넣지 않았습니다.

## r1 공식 인터페이스 확인

공식 SDK의 `longPressStart`, `longPressEnd`, `sideClick`을 사용했습니다. 표준 `getUserMedia`와 `MediaRecorder`는 지원 여부를 검사합니다. 공개 SDK에는 외부 제작용 내장 STT의 시작·중지·최종 결과 콜백이 확인되지 않았습니다. 메서드 이름을 추측하지 않았습니다.

2026-04-03 공식 발표는 Creation STT 지원을 알리지만 외부 제작용 코드 예시는 별도 제공 예정이라고 설명합니다. 따라서 이 프로젝트의 `Web Speech` 지원 여부를 r1 내장 STT의 지원 여부로 해석하지 않습니다. r1에서 녹음은 되지만 STT가 없으면, 실기 결과를 확인한 뒤 PC 측 음성 인식 방식부터 제안합니다.

## 확인한 자료

추가 확인: 계정 한도는 이후 별도 읽기 전용 서버에서 실제 조회에 성공했습니다. 이것은 진행 중인 원래 서버·대화 연결의 증명은 아닙니다. [계정 상태창 보고서](account-monitor-report.md)를 참고해 주세요.

- [OpenAI App Server](https://learn.chatgpt.com/docs/app-server): 초기화, 구독, WebSocket 인증, 같은 서버의 원격 TUI.
- [OpenAI Developer commands](https://learn.chatgpt.com/docs/developer-commands): `--remote`, 서버 전송·인증 옵션. 로컬 도움말과 비교했습니다.
- [rabbit SDK 하드웨어 이벤트](https://github.com/rabbit-hmi-oss/creations-sdk/blob/main/plugin-demo/reference/creation-triggers.md).
- [rabbit 공식 STT 발표](https://forum.rabbitcommunity.tech/t/rabbitos-release-notes/40), 2026-04-03 항목.
- [rabbit Creation 설치 안내](https://www.rabbit.tech/support/article/how-to-use-r1-creations).
- [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- [FastAPI WebSocket](https://fastapi.tiangolo.com/advanced/websockets/).

WebSocket app-server는 공식 문서의 실험적 전송입니다. 최소 진단 앱에는 Codex 전송 어댑터를 붙이지 않았습니다.
