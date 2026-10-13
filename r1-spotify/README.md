# R1 Spotify

PC 없이 래빗에서 실행하는 Spotify 리모컨입니다. 재생 중인 곡의 앨범아트·아티스트·제목·앨범명과 진행 시간을 표시합니다. 음악은 같은 Spotify 계정의 현재 재생 기기에서 계속 재생됩니다.

## 조작

- 앨범아트 왼쪽 스와이프: 다음 곡.
- 앨범아트 오른쪽 스와이프: 이전 곡.
- 래빗 옆 버튼 한 번: 재생·일시정지.
- 재생 화면에서 휠 위로: 볼륨 +5%. 아래로: 볼륨 -5%. 실제 Spotify 재생 기기의 볼륨을 0~100% 범위에서 변경합니다. 연속 입력은 모아서 순서대로 처리하고 잠시 볼륨 값을 표시합니다. 기기에서 볼륨 제어를 지원하지 않으면 안내를 표시합니다.
- 앨범아트 탭: 가사. 래빗 휠을 위아래로 돌려 탐색합니다.
- 가사 화면은 평소 가사만 표시합니다. 화면을 탭하거나 Enter 키를 누르면 제목·안내·따라가기 체크박스가 3초 동안 표시됩니다. 다시 탭하면 바로 숨겨지고 체크박스 조작 시 표시 시간이 다시 시작됩니다. 탭만으로 따라가기를 해제하지 않습니다.
- 가사 화면의 ‘현재 가사 따라가기’ 체크: 현재 재생 줄로 즉시 이동하고 계속 따라갑니다. 해제하면 자유롭게 스크롤합니다. 휠·터치 탐색 시 체크가 해제됩니다.
- 가사 화면에서 왼쪽 또는 오른쪽 스와이프: 재생 화면으로 돌아갑니다. 세로 움직임·짧은 움직임·취소된 터치는 복귀로 처리하지 않습니다. 키보드 Escape도 지원합니다.
- 점 세 개: 로그인·연결 해제·도움말.

가사는 Spotify 앱의 가사 유무와 관계없이 **벅스**에서 먼저 찾습니다. 같은 출처의 `/api/lyrics/bugs` 서버가 공개 검색 결과에서 제목·가수가 일치하는 곡을 찾고, 곡 길이 차이 2초 이내인 후보의 일반 가사만 반환합니다. 같은 앨범을 우선하며 중복 제거 후 최대 세 후보를 확인합니다. 벅스의 가수 표기에 포함된 한국어·영어 별칭은 허용하지만 다른 버전명은 제거하지 않습니다. 벅스 조회에 없거나 실패하면 기존 **LRCLIB** 정확 조회·재검색, **lyrics.ovh** 대체 조회를 사용합니다. 화면을 탭하면 실제 제공처가 표시됩니다. 벅스 일반 가사는 시간 정보가 없어 따라가기를 비활성화하고 휠로 탐색합니다. 조회 서버에는 제목·가수·앨범·곡 길이만 전송하며 Spotify 토큰과 벅스 등록자 정보는 전달하지 않습니다. 벅스 조회는 전체 20초, 브라우저 대기는 25초로 제한하며 성공 응답은 기기에서 5분간 재사용할 수 있습니다. 벅스의 공개 페이지 구조나 곡 표기가 변경되면 조회가 실패할 수 있으며, 영어로만 표기된 Spotify 제목과 벅스의 한국어 제목은 자동 번역하지 않습니다.

## 처음 연결

앱 주소: https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/

1. 기존 Client ID를 사용할 경우 앱 소유자에게 Spotify 사용자 허용 목록 등록을 요청합니다. 본인 앱을 사용할 경우 [Spotify 개발자 페이지](https://developer.spotify.com/dashboard)에서 Premium 계정으로 로그인하고 Web API 앱을 등록합니다.
2. 본인 앱의 Redirect URI에 `https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/`를 정확히 등록합니다. 끝의 `/`도 포함합니다. 직접 배포했다면 연결 설정에 표시되는 자신의 배포 주소를 등록합니다.
3. 기존 **Client ID**는 연결 설정에 기본값으로 입력되어 있습니다. 본인 앱을 사용할 때는 발급받은 Client ID로 변경합니다. Client Secret은 사용하지 않습니다.
4. 래빗 Creation에서 Spotify 로그인과 재생 상태 읽기·제어 동의를 진행합니다.
5. 휴대폰·PC·스피커의 Spotify에서 곡을 재생합니다. 래빗 앱에 현재 곡이 표시됩니다.

Spotify 로그인·재실행 로그인 유지는 r6에서 사용자 실기 확인을 받았습니다. 다만 다른 사용자 계정의 로그인과 최신 코드의 래빗 WebView 동작까지 검증했다는 뜻은 아닙니다.

기존 운영 기록에 따르면 사이트는 사용자 선택에 따라 비공개로 유지되었고 래빗에서도 소유자 ChatGPT 로그인이 필요했습니다. 현재 공유 설정은 배포 관리 화면에서 별도로 확인해야 합니다. 사용자는 r6에서 Spotify 연결·재실행 로그인 유지·가사 휠 탐색·현재 줄 따라가기·하단 버튼 표시가 정상이라고 확인했습니다. 개인 Spotify 토큰과 현재 재생 정보는 사이트 서버에 저장하거나 다른 방문자와 공유하지 않습니다.

## 다른 사용자도 사용할 수 있나요?

**코드는 다른 사용자의 Spotify 계정을 지원하지만, GitHub에 소스가 공개되어 있다는 것만으로 기존 앱 주소를 누구나 사용할 수 있는 것은 아닙니다.** 사이트 접근 권한과 Spotify 앱 사용 권한을 각각 충족해야 합니다.

| 사용 방식 | 필요한 조건 |
| --- | --- |
| 기존 사이트 + 기본 Client ID | 사이트에 접근할 수 있어야 하며, Spotify 앱 소유자가 해당 사용자를 허용 목록에 등록해야 합니다. |
| 기존 사이트 + 본인 Client ID | 사이트 접근 권한은 여전히 필요합니다. 본인 Spotify 앱에 기존 사이트 주소를 Redirect URI로 등록하고 설정에서 Client ID를 변경합니다. |
| 본인 사이트 + 본인 Client ID | 저장소를 복제해 HTTPS 서버에 배포하고, 본인 Spotify 앱에 새 주소를 Redirect URI로 등록합니다. rabbit Creation의 URL도 새 주소로 지정합니다. |

### 소수 사용자에게 공유

1. 기존 기록상 배포 사이트는 비공개입니다. 먼저 다른 사용자가 접근할 수 있도록 사이트 공유 권한을 설정하거나 별도 배포 주소를 준비합니다. 현재 배포 관리 화면의 공개 여부는 이 README 업데이트 과정에서 확인하지 않았습니다.
2. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)에서 앱 → **Settings → Users Management → Add new user**를 열어 사용자의 이름과 Spotify 계정 이메일을 추가합니다.
3. 사용자는 자신의 Spotify 계정으로 로그인하고, 같은 계정의 휴대폰·PC·스피커에서 먼저 곡을 재생합니다. 재생 제어 API에는 해당 사용자의 Spotify Premium이 필요합니다.
4. 각 사용자는 자신의 기기와 브라우저 프로필을 사용합니다. 로그인 토큰은 기기에 저장되므로 같은 기기·프로필을 다른 사람이 사용할 때는 먼저 ‘이 기기 연결 해제’를 누릅니다. 계정 비밀번호나 토큰을 공유할 필요는 없습니다.

2026-10-14 확인한 [Spotify 공식 개발자 모드 정책](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)에 따르면 앱 소유자는 Premium이어야 하며, 개발자 모드 앱은 허용 목록에 등록된 **최대 5명의 인증 사용자**가 사용할 수 있습니다. 허용 목록에 없는 계정은 로그인에 성공하더라도 API 호출이 **403**으로 거부될 수 있습니다. 현재 기본 Client ID의 실제 모드·허용 목록·남은 자리는 소스에서 확인할 수 없으므로 앱 소유자가 Dashboard에서 확인해야 합니다.

불특정 다수에게 기본 Client ID 하나로 제공하려면 Spotify의 **Extended quota mode** 승인이 필요합니다. 공식 안내상 신규 신청은 개인이 아닌 조직을 대상으로 하며, 등록 사업체·출시 서비스·최소 월간 활성 사용자 25만 명 등의 요건이 있습니다. 사이트를 공개하는 것만으로 Spotify 사용자 제한이 해제되지는 않습니다. 정책은 변경될 수 있으므로 공유 전에 공식 문서를 다시 확인합니다.

### 직접 배포

```powershell
git clone https://github.com/plutoparty1/Rabbit_R1.git
cd Rabbit_R1/r1-spotify
node scripts/build.mjs
```

빌드 결과인 `dist/server/index.js`를 진입점으로 하고 `bugs.mjs`·`assets.mjs`를 함께 Cloudflare Worker 등 호환 런타임에 배포합니다. 저장소에는 계정별 배포 설정이나 자동 배포 명령이 포함되어 있지 않아 호스팅 설정은 별도로 준비해야 합니다. `dist`만 정적 호스팅하면 벅스 조회용 `/api/lyrics/bugs` 서버가 제공되지 않습니다.

배포 후 Spotify 앱의 Redirect URI를 새 HTTPS 주소와 정확히 맞추고, 연결 설정에서 본인 Client ID를 입력합니다. [Creation 설치 정보](docs/install-creation.json)의 `url`도 새 주소로 변경합니다. [기존 설치 QR](docs/install-qr.png)은 기존 배포 주소용이므로 자체 배포에는 그대로 사용하지 않습니다. 주소가 바뀌면 저장소 출처도 바뀌므로 Spotify에 다시 로그인해야 합니다.

다른 사용자 계정과 실제 rabbit 기기로 이 전체 공유 절차를 시험한 것은 아닙니다. 코드의 계정별 로그인 구조와 공식 정책을 확인한 안내이며, 배포 후 접근·로그인·재생 제어를 각 사용자 기기에서 확인해야 합니다.

## 저장과 연결

Spotify PKCE 로그인과 일회용 상태 검증을 사용합니다. 로그인 준비 정보만 같은 출처의 localStorage에 10분 유효 기간으로 보관하여 새 WebView에서도 마무리할 수 있게 합니다. 완료·연결 해제·다음 실행 시 만료 확인 후 폐기합니다. 실제 접근·갱신 토큰은 래빗 보안 저장소와 같은 출처의 기기 IndexedDB 백업에 보관합니다. 보안 저장소가 성공 응답을 반환해도 실제로 저장하지 않을 수 있으므로 IndexedDB 백업을 삭제하지 않습니다. 보안 저장소의 늦은 주입도 제한된 시간 안에서 재확인합니다. 다른 영구 저장이 없으면 보안 저장 후 읽기 검증까지 성공해야 로그인 유지로 안내합니다. IndexedDB는 브라우저 저장소이며 래빗의 하드웨어 암호화 저장소는 아닙니다. 토큰을 localStorage나 사이트 서버에는 저장하지 않습니다.

앱을 다시 열면 로그인 정보를 복원하고 만료된 접근 토큰을 자동 갱신합니다. 기존 탭에만 남아 있는 로그인도 다음 실행부터 기기에 보관합니다. ‘이 기기 연결 해제’를 누르면 저장된 토큰을 제거하며, 보안 저장소 삭제가 실패해도 연결 해제 기록으로 이전 로그인의 복원을 차단합니다. 기기 저장소가 모두 제한되거나 브라우저 데이터를 지운 경우, 또는 Spotify에서 권한을 취소한 경우에는 다시 로그인이 필요합니다. Client ID는 공개 앱 식별자로서 기기 localStorage에 보관합니다. 인증값은 소스·QR·로그에 넣지 않으며 콜백의 일회용 코드는 주소에서 즉시 제거합니다.

현재 곡은 앱이 보이는 동안 약 3초마다 확인합니다. 시간은 그 사이에 보간하며 429 제한 응답의 Retry-After를 따릅니다. 재생 명령은 한 번만 전송하고 실패한 다음 곡 명령을 무조건 재시도하지 않습니다. 인터넷 단절 시 마지막 정보임을 표시합니다.

앱 복귀는 visibilitychange·pageshow·focus를 함께 처리하며 겹친 신호는 하나의 갱신으로 모읍니다. 전환 중 일시적인 0 높이로 마지막 정상 화면 크기를 덮어쓰지 않고 복귀 후 1초 동안 화면 크기를 재확인합니다. 앱을 떠날 때 조회 예약·대기 볼륨 입력·이전 응답을 무효화합니다. 복귀 시 현재 재생을 다시 확인하고 중단되거나 실패한 가사만 재조회하며 이미 표시된 가사와 자유 탐색 위치는 유지합니다. 이 경로는 브라우저 모의 시험으로 검증했으며 실제 래빗 WebView 복귀 확인은 별도입니다.

## 검증

```powershell
node scripts/build.mjs
node --test tests/*.test.mjs
node --check dist/app.mjs
node --check dist/spotify.mjs
```

`tests/browser-check.js`는 Playwright 도구에서 실행하는 함수입니다. `http://127.0.0.1:8791/`에 `dist`를 제공한 뒤 실행합니다. Spotify·앨범아트·가사를 명시적으로 모의 처리하며 실제 계정이나 유료 재생을 호출하지 않습니다. 240×282 화면, 두 방향 스와이프, 물리 버튼 이벤트의 중복 억제, 가사 시간 갱신, 휠 탐색, WebMCP 입력 검사를 확인합니다. 화면 이미지는 모의 시험 자료입니다.

새 패키지 설치는 필요 없습니다. 벅스의 브라우저 직접 연결 제한 때문에 배포에 서버가 필요합니다. `node scripts/build.mjs`는 기존 `dist` 화면을 그대로 포함한 Cloudflare Worker를 `dist/server`에 생성합니다. 서버 원본은 `server/bugs.mjs`, `server/worker.mjs`이며 생성 파일은 영구 배포 자료로서 Git에서 제외합니다. 화면을 수정한 뒤에는 배포 전에 다시 빌드해야 합니다. 실제 Spotify 제어·래빗 실기 성공 여부는 모의 테스트와 구분합니다.

`tests/auth-recovery-check.js`는 응답하지 않는 래빗 보안 저장소, 새 WebView로 돌아오는 콜백, 중단된 로그인 안내, 앱 재실행 로그인 복원, 삭제에 실패한 보안 저장소의 예전 토큰 차단을 모의 시험합니다. 실제 기기의 재시험은 아직 필요합니다.

`tests/improvements-check.js`는 같은 Playwright 실행 방식으로 로그인 유지·만료 토큰 갱신·연결 해제, 연속 휠 입력, 따라가기 체크/해제, 일반 가사, 스와이프 및 Escape 복귀를 검사합니다. 재생 버튼이 240×282, 240×360, 360×640 화면에서 잘리지 않고 하단 여백을 유지하는지도 확인합니다. 별도 린트·타입 검사 설정은 없으며 Node 구문 검사·서버 빌드·실행 테스트로 검증합니다.

`tests/volume-check.js`는 같은 실행 방식으로 휠 방향·5% 단위·0~100% 경계·연속 입력 누적·요청 직렬 처리·기기 및 화면 변경 시 대기 입력 취소·미지원 기기·오류 시 자동 재전송 방지·가사와 설정 탐색 보존을 모의 시험합니다.

`tests/device-recovery-check.js`는 240×240·240×212 화면과 축소된 visualViewport, 구형 WebView의 스크롤 옵션 거부·무시, document 이벤트·표준 wheel·방향키, 체크박스에 초점이 있는 탐색, 자동 가사 따라가기, 보안 저장의 허위 성공 응답·늦은 초기화를 재현합니다. `tests/lyrics-swipe-check.js`는 좌우 스와이프 복귀·세로 탐색·짧은 터치·취소·체크박스 조작·휠 탐색을 검증하며 가사 스와이프가 곡 변경 명령을 전송하지 않는지도 확인합니다.

`tests/lyrics-controls-check.js`는 기본 가사 전용 화면·탭 표시/숨김·3초 자동 숨김·체크박스 조작 시 시간 연장·따라가기 유지·자유 탐색 위치 보존·세로 탐색 구분·키보드 접근·가사 없는 상태 표시를 검증합니다. `docs/lyrics-only-240x282.png`와 `docs/lyrics-controls-240x282.png`는 모의 응답으로 만든 영구 검증 이미지입니다.

`tests/lyrics.test.mjs`는 벅스 우선 조회·LRCLIB 재검색·동일 곡 판별·lyrics.ovh 대체 조회·연주곡·장애와 가사 없음 구분·인증 정보 미전송·보안 정책을 모의 시험합니다. `tests/bugs.test.mjs`와 `tests/worker.test.mjs`는 벅스 검색 구조·가수 별칭·곡 길이·요청 제한·응답 검사·기존 화면 제공을 검증합니다. `tests/resume-check.js`는 일시적인 0 높이·복귀 신호·늦은 화면 크기 복원·중복 조회 억제·백그라운드 조회 중단·대체 가사의 안전한 표시·탐색 위치 유지·복귀 후 가사 재시도를 같은 Playwright 방식으로 검증합니다. `tests/bugs-browser-check.js`는 Spotify 재생을 모의 처리하고 시올의 ‘살얼음’을 실제 벅스 공개 조회로 받아 앱의 출처·일반 가사 표시를 확인합니다. 실제 가사 전문을 시험 코드나 로그에 저장하지 않습니다.

## 실기 호환과 상태 확인

- 화면 높이를 최소 282px로 강제하지 않고 실제 표시 영역에 맞추며 재생 버튼 아래에는 24px 여백을 확보합니다.
- 휠은 window/document의 rabbit 이벤트, 표준 wheel, 위아래 방향키 입력을 받습니다. 가사 이동은 구형 WebView에서도 지원되는 scrollTop을 사용합니다. 시간 정보가 없는 가사는 체크박스를 해제·비활성화합니다.
- 안드로이드 휴대폰 재생만으로 원격 음량 제어 가능 여부를 단정하지 않습니다. Spotify의 실제 supports_volume·volume_percent·is_restricted 응답을 기준으로 제어하며, 미지원 휴대폰에서는 휴대폰에서 음량을 조절하도록 안내합니다.
- 설정의 ‘기기 확인’에서 재생 기기·음량 지원 여부, 휠 입력 횟수, 표시 영역, 로그인 저장 확인 결과를 볼 수 있습니다. 현재 저장소의 화면 표시 버전은 20261008-r13이며 변경된 자원 주소에 버전값을 넣어 이전 CSS/JavaScript 재사용을 줄입니다. 배포 사이트가 같은 버전인지는 별도로 확인해야 합니다.
- 사용자 실기 보고는 모의 시험과 구분합니다. r6의 네 가지 개선은 사용자 확인을 받았으며, r7의 탭 안내 기능은 실기 재확인이 필요합니다.

## 참고

- [Spotify 재생 API](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback)
- [Spotify 볼륨 제어 API](https://developer.spotify.com/documentation/web-api/reference/set-volume-for-users-playback)
- [Spotify PKCE 로그인](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify 개발자 모드](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [rabbit 하드웨어 이벤트와 보안 저장소](https://github.com/rabbit-hmi-oss/creations-sdk/blob/main/plugin-demo/reference/creation-triggers.md)
- [LRCLIB API](https://lrclib.net/docs)
- [lyrics.ovh API](https://github.com/NTag/lyrics.ovh#api)
