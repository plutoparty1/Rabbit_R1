// The public Creation SDK has no documented device-language bridge. Use the WebView locale.
export function getLocale(source = globalThis.navigator) {
  const preferred = source?.language || source?.languages?.[0] || 'en';
  return /^ko(?:[-_]|$)/i.test(preferred) ? 'ko' : 'en';
}

const english = {
  '버전 20261018-r19 · 연결 해제 시 저장된 로그인 정보를 삭제합니다.': 'Version 20261018-r19 · Disconnect removes saved login data.',
  '가사 끝': 'End of lyrics',
  '전체 가사 · 휠이나 터치로 아래로 탐색': 'Full lyrics · scroll down with wheel or touch',
  '버전 20261018-r18 · 연결 해제 시 저장된 로그인 정보를 삭제합니다.': 'Version 20261018-r18 · Disconnect removes saved login data.',
"이 기기는 누구와 사용하나요?": "Who uses this device?",
"내 기기 · 로그인 유지": "My device · keep me signed in",
"공용 기기 · 이번만 로그인": "Shared device · this visit only",
"공용 기기는 새로고침·재실행 시 다시 로그인합니다. 사용 후 연결 해제를 눌러 주세요.": "Shared devices require login after reload or reopening. Disconnect when finished.",
"본인 Client ID로 연결하고 기기 사용 방식을 선택합니다. 서버를 배포할 필요는 없습니다.": "Connect with your Client ID and choose a device mode. No server deployment is needed.",
"공용 기기: 로그인은 현재 화면에서만 유지됩니다.": "Shared device: login lasts for this page only.",
"기기 사용 방식을 선택해 주세요.": "Choose a device mode.",
"기기 사용 방식을 저장할 수 없습니다.": "Could not save the device mode.",
"기기 설정을 변경했습니다. 다시 로그인해 주세요.": "Device mode changed. Please log in again.",
"버전 20261018-r17 · 연결 해제 시 저장된 로그인 정보를 삭제합니다.": "Version 20261018-r17 · Disconnect removes saved login data.",
"내 Spotify 앱으로 연결": "Connect your own Spotify app",
"처음 한 번 Client ID를 설정하면 다음부터 연결을 복원합니다. 서버를 배포할 필요는 없습니다.": "Set up your Client ID once. Your connection is restored on reopening. No server deployment is needed.",
"1. Spotify 앱 만들기": "1. Create a Spotify app",
"휴대폰이나 PC에서 Developer Dashboard를 열고 본인 Premium 계정으로 로그인합니다. Create app에서 이름·설명을 입력하고 Web API를 선택합니다.": "On a phone or computer, open Developer Dashboard with your Premium account. Choose Create app, enter a name and description, and select Web API.",
"Developer Dashboard 열기": "Open Developer Dashboard",
"2. 돌아올 주소 등록": "2. Register the return address",
"Spotify 앱 Settings의 Redirect URIs에 아래 주소를 끝의 /까지 그대로 등록하고 저장합니다.": "In your Spotify app Settings, add this exact address to Redirect URIs, including the final /, and save.",
"주소 복사": "Copy address",
"복사했습니다.": "Copied.",
"복사할 수 없습니다. 위 주소를 길게 눌러 복사해 주세요.": "Could not copy. Press and hold the address above to copy it.",
"3. Client ID 입력": "3. Enter your Client ID",
"Spotify 앱 Settings의 Client ID 32자리를 복사해 이 기기에 입력합니다. Client Secret은 입력하지 않습니다.": "Copy the 32-character Client ID from your Spotify app Settings and enter it on this device. Do not enter a Client Secret.",
"본인 앱의 Client ID 32자리": "Your app’s 32-character Client ID",
"Client ID 저장 후 로그인": "Save Client ID and log in",
"Client ID는 이 기기의 브라우저에 저장됩니다. 다른 기기에서 설정했다면 r1에도 입력해 주세요.": "The Client ID is saved in this device’s browser. If you set it up on another device, enter it on r1 too.",
"로그인 후 같은 Spotify 계정의 휴대폰·PC·스피커에서 음악을 재생해 주세요.": "After login, play music on a phone, computer or speaker using the same Spotify account.",
"권한 오류가 나면?": "Playback permission denied?",
"본인 Spotify 앱의 Users Management에서 로그인할 계정이 허용되어 있는지 확인합니다. 필요하면 Add new user에 본인 이름과 Spotify 이메일을 등록합니다. Premium과 재생 기기 제한도 확인해 주세요.": "In your own Spotify app’s Users Management, check access for the account you use to log in. If needed, add your name and Spotify email with Add new user. Also check Premium and playback-device restrictions.",
"이전 공용 연결을 해제했습니다. 본인 앱의 Client ID를 입력해 다시 연결해 주세요.": "The previous shared connection was removed. Enter your own app’s Client ID to reconnect.",
"Client ID 32자리를 입력해 주세요.": "Enter the 32-character Client ID.",
"버전 20261018-r16 · 연결 해제 시 저장된 로그인 정보를 삭제합니다.": "Version 20261018-r16 · Disconnect removes saved login data.",
"Spotify에 로그인하면 연결됩니다. 음악은 휴대폰·컴퓨터·스피커에서 재생해 주세요.": "Log in to connect. Play music on your phone, computer or speaker.",
"고급 설정 · 직접 배포한 경우": "Advanced · self-hosted instances",
"일반 사용자는 변경할 필요가 없습니다.": "You do not need to change this to use the hosted app.",
"본인 Spotify 앱의 Client ID": "Your Spotify app Client ID",
"연결 도움말": "Connection help",
"Spotify 로그인 후 같은 계정의 다른 기기에서 음악을 재생해 주세요. 별도 앱 등록이나 배포는 필요하지 않습니다.": "After login, play music on another device with the same account. No app registration or deployment is needed.",
"로그인 후 재생 권한 오류가 나오면 운영자에게 계정 사용 권한을 확인해 주세요. Premium과 재생 기기 제한도 영향을 줄 수 있습니다.": "If playback permission is denied, ask the operator to check account access. Premium and playback-device restrictions may also apply.",
"직접 배포한 개발자만 Spotify 앱에 아래 Redirect URI를 등록하고 고급 설정의 Client ID를 변경합니다.": "For developers hosting their own instance: register this Redirect URI in your Spotify app and change the Client ID in Advanced settings.",
"버전 20261018-r15 · 연결 해제 시 저장된 로그인 정보를 삭제합니다.": "Version 20261018-r15 · Disconnect removes saved login data.",
  '연결 설정': 'Connection settings', '현재 곡 가사 보기': 'Show lyrics',
  'Spotify를 연결해 주세요.': 'Connect Spotify.', '아티스트': 'Artist', '앨범': 'Album',
  '재생 중인 음악': 'Now playing', '제목 미제공': 'Untitled', '곡 재생 진행': 'Track progress',
  '연결이 필요합니다.': 'Connect to Spotify', '재생 제어': 'Playback controls',
  '이전 곡': 'Previous track', '다음 곡': 'Next track', '재생': 'Play', '일시정지': 'Paused',
  '가사 정보와 따라가기 설정': 'Lyrics information and follow settings', '가사': 'Lyrics',
  '좌우로 밀어 주세요.': 'Swipe left or right.', '현재 가사 따라가기': 'Follow current line',
  '가사. 탭하거나 Enter 키로 따라가기 설정을 표시합니다.': 'Lyrics. Tap or press Enter for follow settings.',
  '가사를 불러오고 있습니다.': 'Loading lyrics…', 'Spotify 연결': 'Connect Spotify',
  '설정 닫기': 'Close settings', '닫기': 'Close',
  'Spotify에서 곡을 재생한 뒤 연결해 주세요. 음악은 현재 기기에서 재생됩니다.': 'Play a track in Spotify, then connect. Music plays on your current device.',
  '앱 등록 후 한 번 입력해 주세요.': 'Enter once after registering your app.', 'Spotify 로그인': 'Log in to Spotify',
  '이 기기 연결 해제': 'Disconnect this device', '처음 연결하는 방법': 'First-time setup',
  'Spotify 개발자 페이지': 'Spotify developer dashboard', '에서 Web API 앱을 등록해 주세요.': ': register a Web API app.',
  'Redirect URI에 아래 주소를 그대로 등록해 주세요.': 'Register this exact Redirect URI.',
  'Client ID를 입력하고 로그인해 주세요. Client Secret은 필요하지 않습니다.': 'Enter your Client ID and log in. No Client Secret is needed.',
  '개발자 앱 소유 계정에 Premium이 필요합니다.': 'The developer app owner needs Premium.',
  '조작 안내': 'Controls', '앨범아트 왼쪽으로 밀기: 다음 곡': 'Swipe artwork left: next track',
  '앨범아트 오른쪽으로 밀기: 이전 곡': 'Swipe artwork right: previous track',
  '래빗 버튼 한 번: 재생·일시정지': 'Press rabbit button: play/pause', '앨범아트 누르기: 가사': 'Tap artwork: lyrics',
  '재생 화면 휠 위/아래: 볼륨 +5%/-5%': 'Player wheel up/down: volume +5%/-5%',
  '가사·설정 화면 휠: 탐색': 'Lyrics/settings wheel: scroll', '가사 화면 좌우로 밀기: 재생 화면': 'Swipe lyrics left/right: player',
  '‘현재 가사 따라가기’를 체크하면 재생 위치로 이동하고, 해제하면 자유롭게 탐색할 수 있습니다. 휠·터치 탐색 시 체크가 해제됩니다. 서버에 Spotify 가사 연결을 설정했다면 기본 가사를 먼저 확인하고, 없으면 외부 제공처를 조회합니다. 한국어는 벅스를 우선하고, 다른 언어는 LRCLIB을 우선합니다. 가사는 원문으로 표시하며 시간 정보가 있는 곡만 따라갑니다.': 'Enable “Follow current line” to follow playback; disable it to browse. Wheel/touch scrolling disables following. Spotify lyrics are checked first when configured on the server, then external sources. Korean prefers Bugs; other languages prefer LRCLIB. Lyrics stay in their original language. Only timed lyrics can follow playback.',
  '기기 확인': 'Device diagnostics', '재생 기기 정보를 기다리고 있습니다.': 'Waiting for playback device…',
  '휠 입력을 기다리고 있습니다.': 'Waiting for wheel input…', '로그인 유지 상태를 확인하고 있습니다.': 'Checking saved login…',
  '버전 20261013-r14 · 연결 해제 시 저장된 로그인 정보를 삭제합니다.': 'Version 20261013-r14 · Disconnecting deletes saved login.',
  '음악 트랙을 재생해 주세요.': 'Play a music track.', '앨범아트가 없습니다.': 'No artwork available.',
  'Spotify에서 곡을 재생해 주세요.': 'Play a track in Spotify.', 'Spotify 연결 설정': 'Spotify connection settings',
  '이름 미제공': 'Unnamed', '음량 조절 지원': 'Volume control supported', '연결 끊김 · 마지막 정보': 'Offline · last known state',
  '재생 중': 'Playing', '재생 대기': 'Waiting for playback', '연결을 확인해 주세요.': 'Check your connection.',
  '로그인이 필요합니다.': 'Login required.', '잠시 후 다시 연결합니다.': 'Reconnecting shortly…',
  '재생 상태를 먼저 확인해 주세요.': 'Check playback status first.', '현재 기기에서는 이 동작을 사용할 수 없습니다.': 'This action is unavailable on the current device.',
  '변경 중': 'Updating…', '조작을 완료하지 못했습니다.': 'Could not complete the action.',
  '휴대폰에서 음량 조절': 'Adjust volume on your phone', '기기 음량 조절 미지원': 'Remote volume unsupported',
  '이 휴대폰의 원격 음량 조절을 지원하지 않습니다. 휴대폰에서 음량을 조절해 주세요.': 'Remote volume is unsupported on this phone. Adjust volume on the phone.',
  '현재 기기의 음량 정보가 없어 원격 음량을 조절할 수 없습니다.': 'Remote volume is unavailable: the device did not report its volume.',
  '현재 기기에서 볼륨 조절을 사용할 수 없습니다.': 'Volume control is unavailable on this device.',
  '음악을 먼저 재생해 주세요.': 'Play music first.', '이 곡의 가사가 없습니다.': 'No lyrics available for this track.',
  '가사 · ': 'Lyrics · ', '가사가 없는 연주곡입니다.': 'Instrumental track: no lyrics.',
  '휠로 가사를 탐색할 수 있습니다.': 'Use the wheel to browse lyrics.', '시간 정보가 없는 일반 가사입니다.': 'These lyrics have no timing information.',
  '앨범아트를 불러오지 못했습니다.': 'Could not load artwork.', '이 기기의 연결이 해제되었습니다.': 'This device has been disconnected.',
  '저장소 접근에 실패했습니다. 다시 시도해 주세요.': 'Could not access storage. Please retry.',
  'Spotify 재생 제어': 'Control Spotify playback', '이 기기에 연결된 Spotify의 현재 재생을 변경합니다.': 'Change Spotify playback connected to this device.',
  '유효한 재생 동작이 필요합니다.': 'A valid playback action is required.',
  '로그인 정보를 복원하지 못했습니다. 기기 저장소와 연결 상태를 확인해 주세요.': 'Could not restore login. Check device storage and connection.',
  'Spotify 로그인 완료를 아직 확인하지 못했습니다. 로그인을 다시 누른 뒤 앱으로 자동 돌아올 때까지 기다려 주세요.': 'Spotify login is not confirmed yet. Log in again and wait to return to the app automatically.',
  '래빗 보안 저장소가 응답하지 않습니다.': 'Rabbit secure storage is not responding.',
  '기기 저장소가 응답하지 않습니다.': 'Device storage is not responding.', '기기 저장소를 열 수 없습니다.': 'Could not open device storage.',
  '기기 저장에 실패했습니다.': 'Could not save to device storage.', '로그인 유지: 기기 저장을 확인했습니다.': 'Login saved on this device.',
  '로그인 유지 저장에 실패했습니다. 이 환경에서는 다음 실행에 다시 연결해야 합니다.': 'Could not save login. Reconnect the next time you open the app.',
  'Client ID 32자리를 확인해 주세요.': 'Check the 32-character Client ID.',
  '로그인 요청을 확인할 수 없습니다. 이 기기에서 다시 로그인해 주세요.': 'Could not verify the login request. Log in again on this device.',
  'Spotify 연결이 취소되었습니다.': 'Spotify connection cancelled.',
  'Spotify 로그인을 완료할 수 없습니다. 앱 설정과 계정을 확인해 주세요.': 'Could not complete Spotify login. Check app settings and account.',
  'Spotify 로그인이 필요합니다.': 'Spotify login required.', '연결이 해제되었습니다.': 'Disconnected.',
  'Spotify 요청 제한입니다. 잠시 기다려 주세요.': 'Spotify rate limit reached. Please wait.', 'Spotify에 다시 로그인해 주세요.': 'Log in to Spotify again.',
  '재생 권한이 없습니다. Premium·앱 등록 계정·기기 제한을 확인해 주세요.': 'Playback is not permitted. Check Premium, app account access and device restrictions.',
  'Spotify 앱에서 곡을 먼저 재생해 주세요.': 'Play a track in the Spotify app first.',
  'Spotify 요청에 실패했습니다. 연결 상태를 확인해 주세요.': 'Spotify request failed. Check your connection.',
  '볼륨은 0부터 100까지의 정수여야 합니다.': 'Volume must be an integer from 0 to 100.',
  '지원하지 않는 재생 동작입니다.': 'Unsupported playback action.',
  '가사를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.': 'Could not load lyrics. Please reopen them shortly.',
  '벅스': 'Bugs', '표시 영역: {width}×{height}': 'Viewport: {width}×{height}',
  '재생 기기: {device} · {support}': 'Device: {device} · {support}', '{album} 앨범아트': '{album} artwork',
  '볼륨 {volume}%': 'Volume {volume}%', '휠 {direction} 입력 확인 · {count}회': 'Wheel {direction} received · {count}',
  '위': 'up', '아래': 'down',
  '래빗에서 Spotify 현재 곡을 확인하고 재생을 제어하는 개인용 리모컨입니다.': 'A personal Spotify playback remote for rabbit r1.',
};

export function t(message, locale = getLocale(), values = {}) {
  const translated = locale === 'ko' ? message : english[message] ?? message;
  return translated.replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match);
}
export const translateMessage = t;

// Capture only the initial static copy: track names and lyric text are never translated.
export function createStaticTranslator(document) {
  const texts = [], attributes = [];
  const walker = document.createTreeWalker(document.body, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement.closest('script, style')) continue;
    if (english[node.textContent.trim()]) texts.push([node, node.textContent]);
  }
  for (const element of document.querySelectorAll('[aria-label], [placeholder], meta[name="description"]')) {
    for (const name of ['aria-label', 'placeholder', 'content']) {
      const value = element.getAttribute(name);
      if (value && english[value]) attributes.push([element, name, value]);
    }
  }
  return locale => {
    document.documentElement.lang = locale;
    for (const [node, original] of texts) node.textContent = original.replace(original.trim(), t(original.trim(), locale));
    for (const [element, name, original] of attributes) element.setAttribute(name, t(original, locale));
  };
}
