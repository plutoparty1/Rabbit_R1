# r1 접속 통로 실행 기록

2026-10-07 사용자가 임시 접속 주소와 r1 설치 QR 준비를 승인했습니다. 해당 범위만 실행했습니다. Codex 대화 인계는 실행하지 않았습니다.

- 실제 주소: `https://familiar-charts-lucas-josh.trycloudflare.com`.
- 자동 종료: 2026-10-07 11:49:32 한국 시간.
- 설치 QR: [install-qr.png](install-qr.png), 공개 JSON: [install-creation.json](install-creation.json).
- 실제 PC 브라우저 HTTPS/WSS 및 폐기 시험: [public-access-test.json](public-access-test.json).
- 실제 악성 Origin 차단 시험: [public-origin-test.json](public-origin-test.json).
- 실제 r1: 사용자가 설치·앱 실행·수정 후 WSS 수신을 확인했습니다. 버튼·마이크 시험은 아직 미완료이며, 현재 발화할 수 없어 한국어 음성 시험은 보류합니다.

공식 [Cloudflare Quick Tunnels 안내](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)에 따르면 계정·도메인 없이 시험용 임시 URL을 만들 수 있고, 해당 프로세스를 종료하면 주소가 더 이상 동작하지 않습니다. 운영용 상시 서비스에는 적합하지 않습니다.

다음 범위로 실행했습니다.

1. 공식 배포본의 Windows `cloudflared`를 프로젝트 안에만 받습니다. 시스템 서비스·전역 설치·Codex 설정·방화벽은 변경하지 않습니다.
2. `127.0.0.1:8787`의 진단 앱에만 연결되는 일시적 HTTPS 통로를 실행합니다.
3. 발급된 출처만 허용하도록 진단 서버를 실행하고 HTTPS/WSS·페어링·연결 해제를 원격 주소에서도 확인합니다.
4. 앱 제목·설명·공개 URL만 담은 설치 QR을 만들어 전달합니다. 연결 코드는 별도로 PC에서 표시합니다.
5. r1에서 실제 버튼·한국어 최종 인식·마이크 종료·네트워크 수신을 시험하여 기록합니다.

1~4번은 준비·PC 접속 시험이 완료되었고 5번은 실기 결과를 받기 전까지 미완료입니다.

## 접속 중 발견한 문제와 수정

초기 cloudflared의 서버 인증서 검증은 `certificate signed by unknown authority`로 실패했습니다. 공식 `2026.10.0` 소스의 CA로 실제 서버 인증서와 `h2.cftunnel.com` 이름을 OpenSSL에서 검증하여 통과했습니다. 동일한 공식 CA를 프로젝트 파일로 지정한 `--cacert` 연결은 실제 Cloudflare Edge 등록까지 성공했습니다. 인증서 검증과 서버 이름 검증은 유지했습니다. Windows 인증서 저장소는 변경하지 않았습니다.

도구 SHA-256: `86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c`.
공식 CA 파일 SHA-256: `6a28ce30ea7efade302cbca24b8955f487d8c54abdfa09393e89b51913f727fe`.
CA 출처: [cloudflare/cloudflared 2026.10.0](https://github.com/cloudflare/cloudflared/blob/2026.10.0/tlsconfig/cloudflare_ca.go), 적용 경로는 공식 [CreateTunnelConfig 구현](https://github.com/cloudflare/cloudflared/blob/2026.10.0/tlsconfig/origin_ca.go)에서 확인했습니다.

Python 3.14의 Windows 인증서 경로를 사용한 공개 HTTPS 시험은 `Basic Constraints of CA cert not marked critical`로 실패했고, Mozilla CA 목록만 사용한 시험도 해당 PC 환경에서 발급자 확인에 실패했습니다. 검증을 끄지 않았습니다. 실제 Creation과 같은 웹 API를 사용하는 독립 브라우저 시험으로 HTTPS/WSS를 검증했습니다. `ignoreHTTPSErrors=false`이며 실제 r1의 인증서 신뢰는 별도 미검증입니다.

주소 발급만으로 준비 완료를 표시하지 않도록 실제 Edge 등록을 기다리는 검증을 추가했습니다. 연결 코드 갱신도 새로운 코드가 실제로 생성된 상태까지 기다리도록 수정하고 선행 실패·통과 테스트를 실행했습니다.

앱 화면은 주소를 아는 사람이 볼 수 있습니다. API와 WSS는 일회성 페어링으로 연결한 기기만 접근할 수 있습니다. 진단 앱은 Codex 명령을 받지 않으며 OAuth 인증 파일·업무 내용·녹음 원본을 외부 통로에 제공하지 않습니다. 시험이 끝나면 이 통로의 프로세스만 종료합니다. 현재 Codex 대화의 인계는 별도 [인계안](session-handoff.md)의 승인과 턴 종료 확인 후 진행합니다.
