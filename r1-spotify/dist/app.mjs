// 모든 입력은 같은 명령 함수로 모으고 Spotify의 실제 응답으로 화면을 갱신합니다.
import { normalizePlayer, progressAt, swipeAction, parseLrc, currentLine } from './core.mjs?v=20261025-r25';
import { SpotifyClient, getLyrics, getSessionMode, setSessionMode } from './spotify.mjs?v=20261025-r25';
import { t, getLocale, createStaticTranslator } from './i18n.mjs?v=20261025-r25';
import { VoiceController, createKeylessTranscriber, keylessVoiceMessage } from './voice.mjs?v=20261025-r25';
import { LocalSpeechProbe } from './local-speech.mjs?v=20261025-r25';
import { RabbitProbe } from './rabbit-probe.mjs?v=20261025-r25';
const applyStaticLocale = createStaticTranslator(document);
import { setupPairing } from './pair-device.mjs?v=20261025-r25';
applyStaticLocale(getLocale());
const $ = id => document.getElementById(id);
const redirectUri = new URL('./', location.href).href;
const client = new SpotifyClient({ redirectUri });
let startupReady = false;
let pairingController = null;
let voiceController = null, voiceOpen = false, voiceWasActive = false, voiceFocus = null, voicePointer = null, longPressReset;
let voiceModelLoading = false, voiceModelRun = 0;
let player = normalizePlayer(null), sampledAt = performance.now(), busy = false, stale = false;
let screen = 'player', pollTimer, revision = 0, lastAction = -Infinity;
let volumeTarget = null, volumeDevice = null, volumeTimer;
let wheelCount = 0, lastScroll = null;
let lyricControlsTimer;
let resumeTimer, viewportTimer, suspended = false;
let lines = [], activeLine = -1, lyricRevision = 0, following = true, gesture = null, lyricGesture = null, suppressTapUntil = 0, longPressed = false;
const time = value => `${Math.floor(value / 60000)}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}`;

// 기기 전체 높이가 아니라 실제로 보이는 WebView 높이에 화면을 맞춥니다.
function fitViewport() {
  // 백그라운드 전환 중의 0 높이는 마지막 정상 화면 크기를 덮어쓰지 않습니다.
  const visibleHeight = window.visualViewport?.height ?? innerHeight;
  if (document.hidden || !Number.isFinite(innerHeight) || innerHeight <= 0 || !Number.isFinite(visibleHeight) || visibleHeight <= 0) return;
  const height = Math.max(1, Math.floor(Math.min(innerHeight, visibleHeight)));
  document.documentElement.style.setProperty('--app-height', height + 'px');
  document.documentElement.classList.toggle('compact', height < 360);
  $('viewport-status').textContent = t('표시 영역: {width}×{height}', getLocale(), { width: innerWidth, height });
}
fitViewport(); window.addEventListener('resize', fitViewport); window.visualViewport?.addEventListener('resize', fitViewport);

function show(view) {
  if (voiceOpen) closeVoice();
  if (screen === 'pair' && view !== 'pair') pairingController?.cancel();
  // 다른 화면으로 이동하면 아직 전송하지 않은 볼륨 입력을 취소합니다.
  if (view !== 'player') { clearTimeout(volumeTimer); volumeTarget = null; }
  screen = view;
  for (const element of document.querySelectorAll('.view')) element.hidden = element.id !== view + '-view';
  setLyricsControls(false);
  if (view === 'lyrics') loadLyrics();
  if (view === 'settings') $('disconnect').hidden = !client.connected;
}
function status(text, detail = text) { $('status').textContent = text; $('status').title = detail; }
function controls() {
  $('previous').disabled = voiceOpen || busy || stale || !player.canPrevious;
  $('next').disabled = voiceOpen || busy || stale || !player.canNext;
  $('toggle').disabled = voiceOpen || busy || stale || !player.canToggle;
  $('voice-open').disabled = busy || !client.connected;
  $('toggle').textContent = player.playing ? 'Ⅱ' : '▶';
  $('toggle').setAttribute('aria-label', player.playing ? t('일시정지') : t('재생'));
}
function render() {
  const ready = player.status === 'ready';
  $('artist').textContent = ready ? player.artist : t('아티스트');
  $('title').textContent = ready ? (player.titleMissing ? t('제목 미제공') : player.title) : t('재생 중인 음악');
  $('album').textContent = ready ? player.album : t('앨범');
  for (const id of ['artist', 'title', 'album']) $(id).title = $(id).textContent;
  $('cover').hidden = !ready || !player.image;
  $('empty-art').hidden = ready && Boolean(player.image);
  if (ready && player.image && $('cover').getAttribute('src') !== player.image) $('cover').src = player.image;
  $('cover').alt = ready ? t('{album} 앨범아트', getLocale(), { album: player.album }) : '';
  $('empty-message').textContent = !client.connected ? t('Spotify를 연결해 주세요.') : player.status === 'unsupported' ? t('음악 트랙을 재생해 주세요.') : ready ? t('앨범아트가 없습니다.') : t('Spotify에서 곡을 재생해 주세요.');
  document.querySelector('.empty-action').textContent = client.connected ? '' : t('연결 설정');
  $('art-button').disabled = false;
  $('art-button').setAttribute('aria-label', ready ? t('현재 곡 가사 보기') : t('Spotify 연결 설정'));
  $('spotify-link').href = player.url || 'https://open.spotify.com';
  $('duration').textContent = time(player.duration || 0);
  $('volume-support').textContent = ready ? t('재생 기기: {device} · {support}', getLocale(), { device: player.device || t('이름 미제공'), support: player.canVolume ? t('음량 조절 지원') : volumeHelp() }) : t('재생 기기 정보를 기다리고 있습니다.');
  status(stale ? t('연결 끊김 · 마지막 정보') : ready ? (player.playing ? t('재생 중') : t('일시정지')) : client.connected ? t('재생 대기') : t('연결이 필요합니다.'));
  controls(); tick();
}

// 휴대폰의 시스템 음량을 웹 앱에서 직접 바꾸는 것처럼 안내하지 않습니다.
function volumeHelp() {
  return player.deviceType === 'smartphone' ? t('이 휴대폰의 원격 음량 조절을 지원하지 않습니다. 휴대폰에서 음량을 조절해 주세요.')
    : player.volume === null ? t('현재 기기의 음량 정보가 없어 원격 음량을 조절할 수 없습니다.') : t('현재 기기에서 볼륨 조절을 사용할 수 없습니다.');
}

// 오래된 응답이 새 곡이나 연결 해제 상태를 덮지 못하도록 요청 번호를 확인합니다.
async function refreshPlayer() {
  clearTimeout(pollTimer);
  if (!startupReady || !client.connected || document.hidden || suspended || voiceController?.active) return;
  const request = ++revision;
  let delay = 3000;
  try {
    const next = normalizePlayer(await client.player());
    if (request !== revision) return;
    const changed = next.id !== player.id;
    player = next; sampledAt = performance.now(); stale = false; render();
    if (changed && screen === 'lyrics') loadLyrics();
  } catch (error) {
    if (request !== revision) return;
    stale = true; controls();
    status(client.connected ? t('연결을 확인해 주세요.') : t('로그인이 필요합니다.'), t(error.message));
    if (client.connected) status(error.retryAfter ? t('잠시 후 다시 연결합니다.') : t('연결 끊김 · 마지막 정보'), t(error.message));
    $('auth-message').textContent = t(error.message);
    delay = error.retryAfter ? error.retryAfter * 1000 : 10000;
  } finally {
    if (request === revision && client.connected && !document.hidden && !suspended && !voiceController?.active) pollTimer = setTimeout(refreshPlayer, delay);
  }
}

async function command(action, value) {
  const isVolume = action === 'volume';
  if (voiceOpen || busy || (!isVolume && performance.now() - lastAction < 350)) return { applied: false };
  if (stale || player.status !== 'ready') throw new Error(t('재생 상태를 먼저 확인해 주세요.'));
  const actual = action === 'toggle' ? (player.playing ? 'pause' : 'play') : action;
  if (!(isVolume ? player.canVolume : actual === 'next' ? player.canNext : actual === 'previous' ? player.canPrevious : ['play', 'pause'].includes(actual) && player.canToggle)) {
    throw new Error(t('현재 기기에서는 이 동작을 사용할 수 없습니다.'));
  }
  if (!isVolume) lastAction = performance.now();
  busy = true; revision++; controls(); status(t('변경 중'));
  try {
    await (isVolume ? client.volume(value, player.deviceId) : client.control(actual));
    await refreshPlayer();
    return { applied: true, playing: player.playing, title: player.title };
  } finally { busy = false; controls(); if (!pollTimer && client.connected && !document.hidden && !suspended) pollTimer = setTimeout(refreshPlayer, 3000); }
}
function operate(action) {
  command(action).catch(error => { status(t('조작을 완료하지 못했습니다.'), t(error.message)); $('auth-message').textContent = t(error.message); });
}

// 휠 한 칸은 5%이며 연속 입력을 모아 마지막 목표 볼륨을 순서대로 전송합니다.
function adjustVolume(delta) {
  if (document.hidden || voiceOpen) return;
  if (!client.connected || stale || player.status !== 'ready') { status(t('재생 상태를 먼저 확인해 주세요.')); return; }
  if (!player.canVolume) { const help = volumeHelp(); status(player.deviceType === 'smartphone' ? t('휴대폰에서 음량 조절') : t('기기 음량 조절 미지원'), help); $('auth-message').textContent = help; return; }
  if (volumeDevice !== player.deviceId) volumeTarget = null;
  volumeDevice = player.deviceId;
  const previous = volumeTarget ?? player.volume;
  const target = Math.max(0, Math.min(100, previous + delta));
  if (target === previous) { if (volumeTarget === null) status(t('볼륨 {volume}%', getLocale(), { volume: target })); return; }
  volumeTarget = target;
  clearTimeout(volumeTimer); volumeTimer = setTimeout(flushVolume, 150);
}
async function flushVolume() {
  clearTimeout(volumeTimer);
  // 화면·연결·기기가 바뀌면 이전 기기의 볼륨 입력을 새 기기에 적용하지 않습니다.
  if (voiceOpen || screen !== 'player' || document.hidden || !client.connected || stale || !player.canVolume || volumeDevice !== player.deviceId) { volumeTarget = null; return; }
  if (volumeTarget === null) return;
  if (busy) { volumeTimer = setTimeout(flushVolume, 150); return; }
  const target = volumeTarget, device = volumeDevice;
  try {
    const result = await command('volume', target);
    if (volumeTarget === target && volumeDevice === device) volumeTarget = null;
    if (result.applied && screen === 'player' && client.connected && !stale && player.deviceId === device) status(t('볼륨 {volume}%', getLocale(), { volume: target }));
  } catch (error) {
    volumeTarget = null; status(t('조작을 완료하지 못했습니다.'), t(error.message)); $('auth-message').textContent = t(error.message);
  } finally {
    clearTimeout(volumeTimer);
    if (volumeTarget !== null) volumeTimer = setTimeout(flushVolume, 150);
  }
}

// 탭으로 안내를 표시해도 현재 줄의 따라가기 상태와 자유 탐색 위치를 변경하지 않습니다.
function setLyricsControls(visible) {
  clearTimeout(lyricControlsTimer);
  $('lyrics-controls').hidden = !visible;
  $('lyrics-empty').hidden = visible || $('lyrics-lines').childElementCount > 0;
  if (screen === 'lyrics' && following && lines.length) scrollToCurrent();
  if (!visible && screen === 'lyrics' && $('lyrics-controls').contains(document.activeElement)) $('lyrics-lines').focus();
  if (visible) lyricControlsTimer = setTimeout(() => setLyricsControls(false), 3000);
}
// 가사 없음과 통신 오류는 안내가 숨겨져 있어도 화면에 표시합니다.
function lyricsStatus(text) { $('lyrics-status').textContent = text; $('lyrics-empty').textContent = text; }
async function loadLyrics() {
  const request = ++lyricRevision, track = player;
  lines = []; activeLine = -1; following = $('follow').checked; $('follow').disabled = true;
  $('lyrics-lines').replaceChildren(); $('lyrics-lines').classList.remove('plain');
  $('lyrics-lines').scrollTop = 0; $('lyrics-scroll-hint').hidden = true;
  $('lyrics-empty').hidden = !$('lyrics-controls').hidden;
  $('lyrics-title').textContent = track.title || t('가사');
  // 이전 곡의 제공처를 남기지 않고 현재 응답의 출처만 표시합니다.
  $('lyrics-source').textContent = t('가사');
  lyricsStatus(t('가사를 불러오고 있습니다.'));
  if (track.status !== 'ready') { lyricsStatus(t('음악을 먼저 재생해 주세요.')); return; }
  try {
    const result = await getLyrics(track, getLocale());
    if (request !== lyricRevision || track.id !== player.id) return;
    if (!result) { lyricsStatus(t('이 곡의 가사가 없습니다.')); return; }
    $('lyrics-source').textContent = t('가사 · ') + t(result.source);
    if (result.instrumental) { lyricsStatus(t('가사가 없는 연주곡입니다.')); return; }
    lines = parseLrc(result.syncedLyrics);
    $('follow').disabled = !lines.length;
    if (!lines.length) { following = false; $('follow').checked = false; }
    const texts = lines.length ? lines.map(line => line.text) : (result.plainLyrics || '').split(/\r\n?|\n|\u2028|\u2029/).filter(text => text.trim());
    $('lyrics-lines').classList.toggle('plain', !lines.length);
    lyricsStatus(lines.length ? t('휠로 가사를 탐색할 수 있습니다.') : texts.length ? t('시간 정보가 없는 일반 가사입니다.') : t('이 곡의 가사가 없습니다.'));
    const fragment = document.createDocumentFragment();
    for (const text of texts) { const row = document.createElement('p'); row.textContent = text || '♪'; fragment.append(row); }
    $('lyrics-lines').append(fragment); requestAnimationFrame(updateLyricsScrollHint); $('lyrics-empty').hidden = texts.length > 0 || !$('lyrics-controls').hidden; tick();
  } catch (error) { if (request === lyricRevision) lyricsStatus(t(error.message)); }
}
function tick() {
  const progress = progressAt(stale ? { ...player, playing: false } : player, sampledAt, performance.now());
  $('progress').max = player.duration || 1; $('progress').value = progress; $('elapsed').textContent = time(progress);
  if (screen !== 'lyrics' || !lines.length) return;
  const index = currentLine(lines, progress);
  if (index === activeLine) return;
  $('lyrics-lines').children[activeLine]?.classList.remove('active');
  activeLine = index;
  const row = $('lyrics-lines').children[index];
  row?.classList.add('active');
  if (following && row) scrollToCurrent();
}
// 다시 체크하면 같은 가사 줄이라도 즉시 현재 재생 위치로 이동합니다.
function scrollToCurrent() {
  const row = $('lyrics-lines').children[activeLine];
  if (!row) return;
  const area = $('lyrics-lines'), top = row.offsetTop - area.offsetTop - area.clientHeight / 2 + row.clientHeight / 2;
  // 오래된 WebView가 옵션 객체를 무시해도 현재 줄이 보이도록 직접 이동합니다.
  area.scrollTop = top;
}
function updateLyricsScrollHint() {
  const area = $('lyrics-lines'), hint = $('lyrics-scroll-hint');
  hint.hidden = screen !== 'lyrics' || area.scrollHeight <= area.clientHeight + 2;
  if (!hint.hidden) hint.textContent = t(area.scrollTop + area.clientHeight >= area.scrollHeight - 3 ? '가사 끝' : '전체 가사 · 휠이나 터치로 아래로 탐색');
}
$('lyrics-lines').addEventListener('scroll', updateLyricsScrollHint, { passive: true });
window.addEventListener('resize', updateLyricsScrollHint);
function stopFollowing() { following = false; $('follow').checked = false; }

// 터치 취소와 세로 이동을 구분하고 스와이프 뒤의 클릭을 가사 열기로 처리하지 않습니다.
const surface = $('art-button');
surface.addEventListener('pointerdown', event => {
  if (gesture || !event.isPrimary) { gesture = null; return; }
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
  surface.setPointerCapture?.(event.pointerId);
});
surface.addEventListener('pointerup', event => {
  const start = gesture; gesture = null;
  if (!start || start.id !== event.pointerId) return;
  const action = swipeAction(event.clientX - start.x, event.clientY - start.y, performance.now() - start.at);
  if (action) { suppressTapUntil = performance.now() + 500; operate(action); }
});
surface.addEventListener('pointercancel', () => { gesture = null; suppressTapUntil = performance.now() + 500; });
surface.onclick = () => { if (performance.now() >= suppressTapUntil) show(player.status === 'ready' ? 'lyrics' : 'settings'); };
// 가사에서는 두 방향 모두 복귀 동작이며 체크박스와 세로 탐색을 방해하지 않습니다.
const lyricSurface = $('lyrics-view');
lyricSurface.addEventListener('pointerdown', event => {
  if (lyricGesture || !event.isPrimary || event.target.closest('input, label, button, a')) { lyricGesture = null; return; }
  suppressTapUntil = 0;
  lyricGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), inLines: $('lyrics-lines').contains(event.target) };
  lyricSurface.setPointerCapture?.(event.pointerId);
});
lyricSurface.addEventListener('pointermove', event => {
  if (lyricGesture?.id === event.pointerId && lyricGesture.inLines && Math.abs(event.clientY - lyricGesture.y) >= 8) stopFollowing();
});
lyricSurface.addEventListener('pointerup', event => {
  const start = lyricGesture; lyricGesture = null;
  if (!start || start.id !== event.pointerId) return;
  if (swipeAction(event.clientX - start.x, event.clientY - start.y, performance.now() - start.at)) {
    suppressTapUntil = performance.now() + 500; show('player');
  } else if (Math.abs(event.clientX - start.x) >= 12 || Math.abs(event.clientY - start.y) >= 12 || performance.now() - start.at > 900) suppressTapUntil = performance.now() + 500;
});
lyricSurface.addEventListener('pointercancel', () => { if (lyricGesture?.inLines) stopFollowing(); lyricGesture = null; suppressTapUntil = performance.now() + 500; });
lyricSurface.addEventListener('click', event => {
  if (screen !== 'lyrics' || performance.now() < suppressTapUntil) return;
  setLyricsControls(event.target.closest('input, label, button, a') ? true : $('lyrics-controls').hidden);
});
// 체크박스를 누르고 있는 동안에는 안내가 자동으로 사라지지 않습니다.
$('lyrics-controls').addEventListener('pointerdown', () => clearTimeout(lyricControlsTimer));
$('lyrics-controls').addEventListener('pointerup', () => setLyricsControls(true));
$('previous').onclick = () => operate('previous'); $('next').onclick = () => operate('next'); $('toggle').onclick = () => operate('toggle');
function openVoice() {
  if (!client.connected || busy || document.hidden || suspended || !['player', 'lyrics'].includes(screen)) return false;
  if (!voiceOpen) {
    voiceFocus = document.activeElement;
    voiceOpen = true;
    for (const view of document.querySelectorAll('.view')) view.inert = true;
    $('voice-panel').hidden = false;
    $('voice-cancel').focus();
    controls();
    renderVoiceModel();
  }
  return true;
}
function closeVoice() {
  voiceOpen = false; voicePointer = null;
  voiceModelRun++; voiceModelLoading = false;
  voiceController?.cancel();
  $('voice-panel').hidden = true;
  for (const view of document.querySelectorAll('.view')) view.inert = false;
  if (voiceFocus?.isConnected && !document.hidden) voiceFocus.focus();
  voiceFocus = null; controls();
}
function renderVoice(state = voiceController.state) {
  const active = voiceController.active;
  if (active && !voiceWasActive) {
    revision++; clearTimeout(pollTimer); pollTimer = null;
    clearTimeout(volumeTimer); volumeTarget = null; gesture = null; lyricGesture = null;
  }
  const finished = voiceWasActive && !active;
  voiceWasActive = active;
  $('voice-state').textContent = t(state.message);
  $('voice-panel').dataset.phase = state.phase;
  $('voice-transcript').textContent = state.transcript;
  $('voice-transcript').hidden = !state.transcript;
  $('voice-language').textContent = state.language ? t('감지한 언어: {language}', getLocale(), { language: state.language }) : '';
  $('voice-record').disabled = !localSpeech.ready || voiceModelLoading || (active && !['preparing', 'recording'].includes(state.phase));
  $('voice-record').setAttribute('aria-pressed', String(state.phase === 'recording'));
  $('voice-record').textContent = t(state.phase === 'recording' ? '놓으면 검색' : '누르고 말하기');
  $('voice-results').replaceChildren();
  for (const track of state.tracks) {
    const button = document.createElement('button'); button.type = 'button';
    const title = document.createElement('strong'), artist = document.createElement('span');
    title.textContent = track.name; artist.textContent = track.artists.map(item => item.name).join(', ');
    button.append(title, artist); button.onclick = () => void voiceController.choose(track.uri);
    $('voice-results').append(button);
  }
  controls();
  if (finished && startupReady && client.connected && !document.hidden && !suspended) void refreshPlayer();
  renderVoiceModel();
}
function renderVoiceModel(message) {
  $('voice-prepare').disabled = voiceModelLoading || Boolean(voiceController?.active) || localSpeech.ready;
  $('voice-prepare').textContent = t(localSpeech.ready ? '음성 인식 준비 완료' : voiceModelLoading ? '음성 인식 준비 중…' : '음성 인식 준비');
  $('voice-model-status').textContent = message || t(localSpeech.ready ? '준비 완료 · 버튼을 누른 채 말하고 놓으세요.' : voiceModelLoading ? '모델을 준비하고 있습니다. 처음에는 몇 분 걸릴 수 있습니다.' : '먼저 음성 인식 준비를 눌러 주세요.');
  $('voice-record').disabled = !localSpeech.ready || voiceModelLoading || (Boolean(voiceController?.active) && !['preparing', 'recording'].includes(voiceController.state.phase));
}
const localSpeech = new LocalSpeechProbe({ onState(event) {
  if (!voiceOpen) return;
  if (event.state === 'loading') {
    const progress = event.progress?.progress;
    renderVoiceModel(Number.isFinite(progress) ? t('음성 모델 파일 준비 {progress}%', getLocale(), { progress: Math.round(Math.max(0, Math.min(100, progress))) }) : undefined);
  } else if (['ready', 'cancelled'].includes(event.state)) renderVoiceModel();
  else if (event.state === 'error') renderVoiceModel(t(keylessVoiceMessage(event)));
} });
const rabbitVoice = new RabbitProbe();
voiceController = new VoiceController({ client, onChange: renderVoice, transcriber: createKeylessTranscriber(localSpeech, rabbitVoice),
  canStart: () => startupReady && client.connected && !busy && !voiceModelLoading && !document.hidden && !suspended && ['player', 'lyrics'].includes(screen),
  deviceId: () => player.deviceId || undefined,
});
$('voice-prepare').onclick = async () => {
  if (voiceModelLoading || voiceController.active || localSpeech.ready) return;
  const run = ++voiceModelRun;
  voiceModelLoading = true; renderVoiceModel();
  try {
    await localSpeech.prepare();
    if (run === voiceModelRun && voiceOpen) voiceController.update({ phase: 'idle', message: '버튼을 누른 채 말하고 놓으세요.', transcript: '', language: '', tracks: [] });
  }
  catch (error) { if (run === voiceModelRun && voiceOpen) renderVoiceModel(t(keylessVoiceMessage(error))); }
  finally {
    if (run === voiceModelRun) {
      const previousMessage = $('voice-model-status').textContent;
      voiceModelLoading = false;
      renderVoiceModel(localSpeech.ready ? undefined : previousMessage);
    }
  }
};
$('voice-open').onclick = () => openVoice();
$('voice-cancel').onclick = closeVoice;
const voiceButton = $('voice-record');
voiceButton.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || voiceController.active) return;
  event.preventDefault(); voicePointer = event.pointerId;
  voiceButton.setPointerCapture?.(event.pointerId); void voiceController.begin();
});
voiceButton.addEventListener('pointerup', event => {
  if (event.pointerId !== voicePointer) return;
  event.preventDefault(); voicePointer = null; voiceController.release();
});
voiceButton.addEventListener('pointercancel', () => { voicePointer = null; voiceController.cancel(); });
voiceButton.addEventListener('lostpointercapture', () => {
  if (voicePointer !== null) {
    voicePointer = null;
    if (['preparing', 'recording'].includes(voiceController.state.phase)) voiceController.cancel();
  }
});
voiceButton.addEventListener('contextmenu', event => event.preventDefault());
voiceButton.addEventListener('keydown', event => {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault(); if (!event.repeat) void voiceController.begin();
});
voiceButton.addEventListener('keyup', event => {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault(); voiceController.release();
});
window.addEventListener('sideClick', () => { if (!longPressed && !voiceOpen && ['player', 'lyrics'].includes(screen)) operate('toggle'); });
window.addEventListener('longPressStart', () => {
  clearTimeout(longPressReset); longPressed = true;
  if (openVoice()) void voiceController.begin();
});
window.addEventListener('longPressEnd', () => {
  voiceController.release(); clearTimeout(longPressReset);
  longPressReset = setTimeout(() => { longPressed = false; }, 600);
});
// WebView가 제공하는 사용자 정의 이벤트·표준 휠·방향키를 같은 탐색 함수로 처리합니다.
function editingText(target) {
  return target.isContentEditable || target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(target.type));
}
function scrollInput(direction, source) {
  if (voiceOpen) { $('voice-content').scrollTop += direction * 55; return; }
  const now = performance.now();
  if (lastScroll && lastScroll.source !== source && lastScroll.direction === direction && now - lastScroll.at < 40) return;
  lastScroll = { direction, source, at: now };
  $('input-status').textContent = t('휠 {direction} 입력 확인 · {count}회', getLocale(), { direction: direction < 0 ? t('위') : t('아래'), count: ++wheelCount });
  if (screen === 'lyrics') { stopFollowing(); $('lyrics-lines').scrollTop += direction * 65; }
  else if (screen === 'settings' || screen === 'pair') $(screen + '-view').scrollTop += direction * 65;
  else if (screen === 'player') adjustVolume(-direction * 5);
}
for (const [event, direction] of [['scrollUp', -1], ['scrollDown', 1]]) window.addEventListener(event, () => scrollInput(direction, 'rabbit'), { capture: true });
window.addEventListener('wheel', event => {
  if (!event.deltaY || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || editingText(event.target)) return;
  event.preventDefault(); scrollInput(event.deltaY < 0 ? -1 : 1, 'wheel');
}, { passive: false, capture: true });
document.addEventListener('keydown', event => {
  if (voiceOpen) {
    if (event.key === 'Escape') { event.preventDefault(); closeVoice(); }
    else if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); scrollInput(event.key === 'ArrowUp' ? -1 : 1, 'keyboard'); }
    else if (event.key === 'Tab') {
      const buttons = [...$('voice-panel').querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && (index === -1 || index === buttons.length - 1)) { event.preventDefault(); buttons[0]?.focus(); }
    }
    return;
  }
  // 버튼이나 체크박스에 초점이 있어도 가사 화면에서 재생 화면으로 복귀합니다.
  if (event.key === 'Escape') { event.preventDefault(); show('player'); return; }
  if (screen === 'lyrics' && event.key === 'Enter' && !editingText(event.target) && !['INPUT', 'BUTTON', 'A'].includes(event.target.tagName)) {
    event.preventDefault(); setLyricsControls($('lyrics-controls').hidden);
    if (!$('lyrics-controls').hidden && !$('follow').disabled) $('follow').focus();
    return;
  }
  if (['ArrowUp', 'ArrowDown'].includes(event.key) && !editingText(event.target)) {
    event.preventDefault(); scrollInput(event.key === 'ArrowUp' ? -1 : 1, 'keyboard'); return;
  }
  if (screen === 'settings' || screen === 'pair' || ['INPUT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'A'].includes(event.target.tagName) || event.repeat) return;
  const action = { ArrowLeft: 'previous', ArrowRight: 'next', ' ': 'toggle' }[event.key];
  if (action) { event.preventDefault(); operate(action); }
});
$('lyrics-lines').addEventListener('wheel', stopFollowing, { passive: true });
$('follow').onchange = () => { following = $('follow').checked; setLyricsControls(true); if (following) { tick(); scrollToCurrent(); } };
$('settings-button').onclick = () => show('settings');
$('settings-back').onclick = () => show('player');
$('redirect-uri').textContent = redirectUri;
$('copy-redirect').onclick = async () => {
  try { await navigator.clipboard.writeText(redirectUri); $('copy-message').textContent = t('복사했습니다.'); }
  catch { $('copy-message').textContent = t('복사할 수 없습니다. 위 주소를 길게 눌러 복사해 주세요.'); }
};
pairingController = setupPairing({ show, apply(id) {
  $('client-id').value = id;
  $('restore-client-id').hidden = true;
  $('setup-guide').open = false;
  $('auth-message').textContent = t('Client ID를 받았습니다. 기기 사용 방식을 선택하고 로그인해 주세요.');
} });
$('cover').onerror = () => { $('cover').hidden = true; $('empty-art').hidden = false; $('empty-message').textContent = t('앨범아트를 불러오지 못했습니다.'); };
const modeInputs = [...document.querySelectorAll('input[name="device-mode"]')];
for (const input of modeInputs) {
  input.checked = input.value === getSessionMode();
  input.onchange = async () => {
    closeVoice();
    $('connect').disabled = true; $('restore-client-id').hidden = true;
    try {
      // Disconnect before changing policy; never promote a temporary login to persistent storage.
      await client.disconnect();
      await setSessionMode(input.value);
      player = normalizePlayer(null); stale = false; revision++; clearTimeout(pollTimer); render();
      $('disconnect').hidden = true;
      $('auth-message').textContent = t('기기 설정을 변경했습니다. 다시 로그인해 주세요.');
    } catch (error) { $('auth-message').textContent = t(error.message); }
    finally { for (const radio of modeInputs) radio.checked = radio.value === getSessionMode(); $('connect').disabled = false; }
  };
}
$('connect-form').onsubmit = async event => {
  event.preventDefault(); $('connect').disabled = true;
  try {
    const id = $('client-id').value.trim();
    if (!/^[a-f\d]{32}$/i.test(id)) { $('client-id').focus(); throw new Error('Client ID 32자리를 입력해 주세요.'); }
    // Public app identifier only; session tokens use the existing device store.
    const preferenceStore = getSessionMode() === 'shared' ? sessionStorage : localStorage;
    try { preferenceStore.setItem('r1_spotify_personal_client_id', id); } catch { /* Login can continue without preference storage. */ }
    location.assign(await client.authorize(id));
  } catch (error) { $('auth-message').textContent = t(error.message); $('connect').disabled = false; }
};
$('disconnect').onclick = async () => {
  closeVoice();
  revision++; lyricRevision++; clearTimeout(pollTimer);
  try { await client.disconnect(); player = normalizePlayer(null); stale = false; lines = []; render(); $('disconnect').hidden = true; $('auth-message').textContent = t('이 기기의 연결이 해제되었습니다.'); }
  catch { $('auth-message').textContent = t('저장소 접근에 실패했습니다. 다시 시도해 주세요.'); }
};
// 앱을 떠날 때 대기 입력과 이전 응답을 무효화하여 숨겨진 화면의 갱신을 중단합니다.
function suspend() {
  suspended = true; revision++; lyricRevision++;
  closeVoice(); clearTimeout(longPressReset); longPressed = false;
  for (const timer of [pollTimer, volumeTimer, resumeTimer, viewportTimer]) clearTimeout(timer);
  pollTimer = null; volumeTarget = null; gesture = null; lyricGesture = null;
}

// 복귀 직후 WebView 크기가 늦게 돌아오거나 resize가 생략되어도 1초 안에서 재확인합니다.
function recoverViewport(attempt = 0) {
  clearTimeout(viewportTimer);
  if (document.hidden || suspended) return;
  fitViewport();
  if (screen === 'lyrics' && following && lines.length) scrollToCurrent();
  if (attempt < 10) viewportTimer = setTimeout(() => recoverViewport(attempt + 1), 100);
}

// 여러 복귀 신호를 하나로 모으고 중단되거나 실패한 가사 조회만 다시 시작합니다.
function resume() {
  updateLocale();
  if (document.hidden) return;
  suspended = false; recoverViewport();
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(async () => {
    if (document.hidden || suspended) return;
    render();
    const lyricRequest = lyricRevision, update = refreshPlayer(), playerRequest = revision;
    await update;
    if (!document.hidden && !suspended && playerRequest === revision && lyricRequest === lyricRevision && screen === 'lyrics' && !$('lyrics-lines').childElementCount) loadLyrics();
  }, 100);
}
document.addEventListener('visibilitychange', () => document.hidden ? suspend() : resume());
window.addEventListener('pagehide', suspend);
window.addEventListener('pagehide', () => {
  if (getSessionMode() === 'shared' && client.connected) {
    // Also clear sessions restored from the browser's back/forward cache.
    client.disconnect().catch(() => {});
  }
});
window.addEventListener('pageshow', resume);
window.addEventListener('pageshow', () => {
  if (startupReady && getSessionMode() === 'shared' && !client.connected) { render(); show('settings'); }
});
window.addEventListener('focus', resume);

// 지원되는 브라우저에서만 현재 UI와 동일한 재생 명령을 도구로 제공합니다.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  try {
    Promise.resolve(document.modelContext.registerTool({ name: 'control_spotify_playback', title: t('Spotify 재생 제어'),
      description: t('이 기기에 연결된 Spotify의 현재 재생을 변경합니다.'),
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['toggle', 'next', 'previous'] } }, required: ['action'], additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute(input) { if (!input || Object.keys(input).length !== 1 || !['toggle', 'next', 'previous'].includes(input.action)) throw new Error(t('유효한 재생 동작이 필요합니다.')); return command(input.action); },
    }, { signal: lifecycle.signal })).catch(() => {});
  } catch { /* 미지원 환경에서는 화면과 물리 버튼을 그대로 사용합니다. */ }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
async function start() {
  const returned = new URL(location.href);
  if (returned.searchParams.has('code') || returned.searchParams.has('error')) history.replaceState({}, '', redirectUri);
  try {
    // Client ID는 공개 앱 식별자이며 로그인 토큰이나 Client Secret을 포함하지 않습니다.
    let savedId = '', explicitId = '';
    try {
      const preferences = getSessionMode() === 'shared' ? sessionStorage : localStorage;
      explicitId = preferences.getItem('r1_spotify_personal_client_id') || '';
      savedId = explicitId || (getSessionMode() === 'personal' ? localStorage.getItem('r1_spotify_client_id') || '' : '');
    } catch {}
    // Retire implicit legacy defaults only. An owner may explicitly configure that same ID.
    const retiredSharedId = '3cd6c3a652e44ba0b3f685d4a506a0b8';
    $('client-id').value = /^[a-f\d]{32}$/i.test(savedId) && (savedId !== retiredSharedId || explicitId === savedId) ? savedId : '';
    await client.init(); await client.finish(returned);
    if (client.tokens?.clientId === retiredSharedId && explicitId !== retiredSharedId) {
      await client.disconnect();
      $('auth-message').textContent = t('이전 공용 연결을 해제했습니다. 본인 앱의 Client ID를 입력해 다시 연결해 주세요.');
    }
    if (client.connected && client.tokens?.clientId) $('client-id').value = client.tokens.clientId;
    $('setup-guide').open = !$('client-id').value;
    $('restore-client-id').hidden = Boolean($('client-id').value) || !/^[a-f\d]{32}$/i.test(savedId);
    $('restore-client-id').onclick = () => {
      $('client-id').value = savedId;
      $('restore-client-id').hidden = true;
      $('setup-guide').open = false;
      $('auth-message').textContent = t('기존 Client ID를 불러왔습니다. 로그인 버튼을 눌러 주세요.');
    };
    startupReady = true;
    $('storage-status').textContent = client.connected ? t(client.storage.notice) : t('로그인 정보를 복원하지 못했습니다. 기기 저장소와 연결 상태를 확인해 주세요.');
    render(); await refreshPlayer();
    if (!client.connected) show('settings');
    if (!client.connected && client.authorizationPending) {
      show('settings');
      $('auth-message').textContent = t('Spotify 로그인 완료를 아직 확인하지 못했습니다. 로그인을 다시 누른 뒤 앱으로 자동 돌아올 때까지 기다려 주세요.');
    }
  } catch (error) { render(); show('settings'); $('auth-message').textContent = t(error.message); }
}
let displayedLocale = getLocale();
function updateLocale() {
  const locale = getLocale();
  if (locale === displayedLocale) return;
  displayedLocale = locale;
  applyStaticLocale(locale);
  renderVoice();
  render(); fitViewport();
  $('storage-status').textContent = t(client.storage.notice);
  $('auth-message').textContent = '';
  if (screen === 'lyrics') loadLyrics();
}
window.addEventListener('languagechange', updateLocale);
window.addEventListener('focus', updateLocale);
window.addEventListener('pageshow', updateLocale);
setInterval(() => { if (!document.hidden) tick(); }, 200);
start();
