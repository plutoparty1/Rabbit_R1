# 잔여 한도 중심 화면의 구현·검증

최신 사용자 요청을 반영하여 홈을 한 화면의 계정 한도 상태창으로 변경했습니다. 세션 응답 본문·SDK 카운터·마이크 시험·로그·연결 설정은 기본 화면에서 숨겼습니다. 디자인 기준은 [DESIGN.md](../DESIGN.md)에 기록했습니다.

## 실제 확인한 값

설치된 Codex 0.160.1의 스키마와 [공식 app-server 문서](https://learn.chatgpt.com/docs/app-server)를 확인했습니다. 기존 ChatGPT 인증으로 별도의 읽기 전용 stdio 서버에서 `account/read`와 `account/rateLimits/read`만 호출했습니다. 초기화 외의 대화·모델 메서드는 호출하지 않았습니다.

첫 실제 조회는 Codex 7일 창의 사용 36%·잔여 64%였으며 이후 실제 새로고침에서 사용 37%·잔여 63%로 바뀌었습니다. 다음 초기화는 API의 Unix 시각을 한국 시간으로 표시한 2026-10-10 12:10입니다. 추가 모델 예약 버킷과 크레딧은 합산하지 않았습니다. 두 번째 사용 창은 제공되지 않아 숨겼습니다.

이후 실제 r1에서 잔여 100%·초기화 10월 14일 12:59 표시를 사용자 확인했습니다. 2026-10-07 13:45 한국 시간에 PC에서 원본 API를 다시 조회한 결과 `codex` 버킷의 `usedPercent=0`, `windowDurationMins=10080`, `resetsAt=1791950350`으로 화면과 일치했습니다. 별도의 `base_model_inference` 버킷은 초기화 시각도 다르며 메인에 사용하지 않았습니다. 계정 인증·설정 파일 해시는 처음 진단 때와 동일했습니다.

증거는 [current-quota-source-verification.json](current-quota-source-verification.json)에 기록했습니다. 이전 63%에서 변경된 값은 화면 계산이 아닌 서비스 반환값 자체의 변경입니다. 변경 이유는 API 응답에 제공되지 않아 확정하지 않았습니다.

계정 조회와 진행 중인 원래 세션의 연결 증명은 별개입니다. 원래 PID 37572는 `--no-daemon`으로 계속 실행 중이며 종료하거나 설정을 바꾸지 않았습니다. 계정 조회 프로세스에는 실행 세션의 응답을 구독하지 않습니다.

## 변경 파일

- `companion/quota.py`: 한도 정규화·읽기 전용 stdio 조회·실행별 임시 자료 정리.
- `companion/server.py`: 60초 주기 계정 조회·스냅샷 전달. 세션 상태는 미검증 `null`을 유지합니다.
- `creation/index.html`, `creation/style.css`, `creation/app.mjs`: 240×282 홈과 별도 연결·시험 영역.
- `tests/test_quota.py`, `tests/test_bridge.py`: 값 범위·미제공/0·버킷 구분·개인정보 제거·세션 증명 분리.
- `tests/dashboard-browser-check.js`: 실제 계정 값 표시·홈 진단 숨김·두 사용 창의 화면 범위.

새 패키지를 추가하지 않았습니다. 기존 HTTP/WSS·인증·PTT 코드를 재사용하고 폼과 로그는 상세 화면으로 옮겼습니다.

## 검증 증거

- 한도 모듈 부재 및 브리지 `quota_reader` 미지원 RED 후 최소 구현으로 GREEN.
- 두 사용 창의 화면 넘침 RED 후 기본 `output` 스타일을 제한하여 GREEN.
- Python 21개, PTT 시나리오 9개, Ruff, 구문 검사, 의존성 검사 통과: [dashboard-verification.txt](dashboard-verification.txt).
- 실제 계정 조회와 240×282 브라우저 홈: [account-dashboard-test.json](account-dashboard-test.json).
- 공개 HTTPS/WSS 주소의 실제 계정 값 표시: [account-dashboard-public-test.json](account-dashboard-public-test.json).
- 미등록·명령 전송·폐기 차단 및 8초 시간 제한: [account-dashboard-security-test.json](account-dashboard-security-test.json).
- 설정·인증 파일 해시는 검사 전후 동일합니다.

## 남은 확인

새 홈의 실제 r1 계정 비율·초기화 표시와 PC 원본 일치는 사용자 확인 및 API 재조회로 검증했습니다. 모든 실행 세션의 공유 서버 연결과 실제 이벤트 수신, 한국어 STT, 동일 대화의 명령 제어는 미완료입니다. 지금 화면의 ‘세션 상태’는 연결 준비 상태이며 가짜 이름·개수·진행률을 표시하지 않습니다.

모든 세션의 전체 본문은 작은 화면에 동시에 표시하지 않습니다. 이름·상태 요약을 먼저 모으고 선택한 세션의 최근 응답만 펼치는 구조를 기본 가정으로 두었습니다. 표시 범위에 대한 사용자 답변이 오면 기본값을 조정합니다.
