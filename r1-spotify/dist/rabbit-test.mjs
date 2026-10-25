import { RabbitProbe, SpeechProbe, MicrophoneProbe, PROBE_TEST_TEXT } from './rabbit-probe.mjs?v=20261025-r23-test';

const $ = id => document.getElementById(id);
const VERSION = '20261025-r23-test';
const counts = { hardware: { longPressStart: 0, longPressEnd: 0, sideClick: 0, scrollUp: 0, scrollDown: 0 }, screen: { press: 0, release: 0, cancel: 0 } };
const fresh = () => ({ state: 'not-run', code: '', attempts: 0, durationMs: 0, outputChars: 0 });
const results = { rabbit: fresh(), speech: fresh(), microphone: fresh(), analysis: fresh() };
const statuses = { 'not-run': '미실행', unsupported: '지원 API 없음', pending: '진행 중', success: '성공', error: '실패', 'timed-out': '시간 초과' };
const errors = {
  unsupported: '이 화면에서 필요한 API를 찾지 못했습니다. R1 Creation에서 다시 확인해 주세요.',
  timeout: '응답 대기 시간이 지났습니다. 연결을 확인하고 다시 시도해 주세요.',
  cancelled: '테스트를 취소했습니다.', permission: '마이크 또는 음성 인식 권한이 허용되지 않았습니다.',
  no_microphone: '사용 가능한 마이크를 찾지 못했습니다.', no_speech: '최종 인식 문장이 없습니다. 말한 뒤 버튼을 놓아 주세요.',
  network: '브라우저 음성 인식 서비스에 연결하지 못했습니다.',
  language_unsupported: '선택한 인식 언어를 지원하지 않습니다.',
  invalid_response: '래빗 응답은 왔지만 가수·곡명·언어 형식을 확인하지 못했습니다.',
  bridge_failed: '래빗 AI 브리지에 요청을 보내지 못했습니다.',
  recognition_failed: '음성 인식을 시작하거나 완료하지 못했습니다.',
  capture_failed: '마이크 녹음을 완료하지 못했습니다.', empty_audio: '수집된 오디오 데이터가 없습니다.',
  too_large: '녹음 크기 제한으로 중단했습니다.', invalid_text: '분석할 문장을 확인해 주세요.',
  aborted: '브라우저가 음성 인식을 중단했습니다.', busy: '다른 테스트가 진행 중입니다.', disposed: '페이지를 새로 열어 주세요.',
};
let busy = null, transcript = '', speechSelection = 'ko-KR', sequence = 0, pointerId = null, keyHeld = false;
const rabbit = new RabbitProbe({ onState: event => onProbeState('rabbit', event) });
const speech = new SpeechProbe({ onState: event => onProbeState('speech', event) });
const microphone = new MicrophoneProbe({ onState: event => onProbeState('microphone', event) });

function capabilities() {
  return { secureContext: window.isSecureContext === true, rabbitBridge: rabbit.supported,
    browserSpeech: speech.supported, microphoneRecording: microphone.supported,
    nativeRabbitSpeech: 'not-documented' };
}
function updateCapabilities() {
  const cap = capabilities(), supported = value => value ? '있음' : '없음';
  $('capabilities').textContent = `래빗 AI 브리지: ${supported(cap.rabbitBridge)}\n브라우저 음성 API: ${supported(cap.browserSpeech)}\n마이크 녹음 API: ${supported(cap.microphoneRecording)}`;
  $('hardware-counts').textContent = `실제 옆 버튼 수신 · 누름 ${counts.hardware.longPressStart} / 놓음 ${counts.hardware.longPressEnd} / 짧게 ${counts.hardware.sideClick}`;
  $('screen-counts').textContent = `화면·키보드 입력 · 누름 ${counts.screen.press} / 놓음 ${counts.screen.release} / 취소 ${counts.screen.cancel}`;
}
function render() {
  const capturing = busy?.kind === 'capture';
  $('rabbit-text').disabled = !!busy;
  $('rabbit-analyze').disabled = !!busy || !transcript;
  $('capture-hold').disabled = !!busy && !capturing;
  $('capture-mode').disabled = !!busy;
  $('speech-language').disabled = !!busy;
  $('microphone-status').hidden = $('capture-mode').value !== 'microphone' && results.microphone.state === 'not-run';
  $('capture-hold').setAttribute('aria-pressed', String(capturing));
  $('capture-hold').textContent = capturing ? '놓으면 입력 종료' : $('capture-mode').value === 'microphone' ? '누르고 마이크 확인' : '누르고 말하기';
  $('active-controls').hidden = !busy;
  $('capture-release').hidden = !capturing;
  document.body.classList.toggle('busy', !!busy);
  for (const [key, result] of Object.entries(results)) {
    const el = $(`${key}-status`);
    el.dataset.state = result.state;
    const label = key === 'microphone' ? '마이크 · ' : key === 'speech' ? '음성 인식 · ' : '';
    el.textContent = `${label}${statuses[result.state]}${result.detail ? ` · ${result.detail}` : ''}${result.code ? ` [${result.code}]` : ''}`;
  }
  $('transcript').value = transcript;
  if (results.speech.state === 'success' && results.analysis.state === 'success') {
    $('summary').textContent = '음성 → 텍스트 → 래빗 AI 응답을 확인했습니다. ③ 분석 결과의 가수·곡명이 맞는지 확인해 주세요.';
  } else if (results.rabbit.state === 'success' && ['unsupported', 'error', 'timed-out'].includes(results.speech.state)) {
    $('summary').textContent = '래빗 AI의 문장 분석은 동작합니다. 음성을 텍스트로 받는 경로는 아직 성공하지 못했습니다.';
  } else if (results.speech.state === 'success') {
    $('summary').textContent = '음성 인식은 성공했습니다. ③을 눌러 이 문장을 래빗 AI가 분석할 수 있는지 확인해 주세요.';
  } else if (results.microphone.state === 'success') {
    $('summary').textContent = '마이크 데이터 수집은 성공했습니다. 모드를 “음성 → 텍스트”로 바꾸고 ②를 확인해 주세요.';
  } else if (results.rabbit.state === 'success') {
    $('summary').textContent = '래빗 AI 연결은 성공했습니다. ②에서 음성을 텍스트로 받을 수 있는지 확인해 주세요.';
  } else {
    $('summary').textContent = '①과 ②의 결과를 각각 확인해 주세요. API가 있어도 실제 인식·응답이 성공해야 합니다.';
  }
  updateCapabilities();
}
function onProbeState(controller, event) {
  if (!busy || (busy.kind === 'model' ? controller !== 'rabbit' : busy.key !== controller)) return;
  const key = busy.key;
  if (event.state === 'received') {
    results[key].uncorrelatedResponses = (results[key].uncorrelatedResponses || 0) + 1;
    results[key].detail = '응답 수신 · 요청과 맞는 분석 결과를 기다립니다.';
  } else if (['waiting', 'listening', 'recording', 'stopping'].includes(event.state)) {
    const labels = { waiting: busy.kind === 'model' ? '래빗 응답 대기 중' : '입력 시작·권한 확인 중', listening: '말씀해 주세요 · 놓으면 종료', recording: '마이크 녹음 중 · 놓으면 종료', stopping: '입력 종료 · 결과 기다리는 중' };
    results[key].detail = labels[event.state];
    $('active-status').textContent = labels[event.state];
  }
  if (typeof event.interim === 'string') {
    $('interim').hidden = !event.interim;
    $('interim').textContent = event.interim ? `인식 중: ${event.interim}` : '';
  }
  render();
}
function beginRun(key, kind, source) {
  if (busy || document.hidden) return null;
  const run = { id: ++sequence, key, kind, source, started: Date.now() };
  busy = run;
  results[key] = { ...fresh(), state: 'pending', attempts: results[key].attempts + 1 };
  $('active-status').textContent = kind === 'model' ? '래빗 응답 대기 중' : '입력 시작 중';
  render();
  return run;
}
function failure(key, cause) {
  const code = Object.prototype.hasOwnProperty.call(errors, cause?.code) ? cause.code : 'unknown';
  Object.assign(results[key], { state: code === 'unsupported' ? 'unsupported' : code === 'timeout' ? 'timed-out' : 'error', code, detail: errors[code] || '완료하지 못했습니다. 다시 시도해 주세요.' });
}
function finishRun(run) {
  if (busy !== run) return;
  results[run.key].durationMs = Math.max(0, Date.now() - run.started);
  busy = null;
  $('interim').hidden = true;
  $('interim').textContent = '';
  render();
}
async function runModel(key, text) {
  const run = beginRun(key, 'model', 'screen');
  if (!run) return;
  const output = $(key === 'rabbit' ? 'rabbit-result' : 'analysis-result');
  output.hidden = true;
  output.textContent = '';
  try {
    const result = await rabbit.request(text);
    if (busy !== run) return;
    Object.assign(results[key], { state: 'success', code: '', detail: '가수·곡명·언어 응답 수신', outputChars: result.artist.length + result.title.length + result.language.length });
    output.textContent = `가수: ${result.artist}\n곡명: ${result.title}\n문장 언어: ${result.language}`;
    output.hidden = false;
  } catch (cause) { if (busy === run) failure(key, cause); }
  finally { finishRun(run); }
}
async function startCapture(source) {
  const key = $('capture-mode').value === 'microphone' ? 'microphone' : 'speech';
  const run = beginRun(key, 'capture', source);
  if (!run) return;
  if (key === 'speech') {
    transcript = '';
    results.analysis = fresh();
    $('analysis-result').hidden = true;
    $('analysis-result').textContent = '';
    speechSelection = $('speech-language').value;
  }
  render();
  try {
    const result = await (key === 'speech' ? speech.begin({ lang: speechSelection }) : microphone.begin());
    if (busy !== run) return;
    if (key === 'speech') {
      transcript = result.transcript;
      Object.assign(results[key], { state: 'success', detail: `${transcript.length}자 인식 · ③을 눌러 분석`, outputChars: transcript.length });
    } else {
      Object.assign(results[key], { state: 'success', detail: `${result.bytes}바이트 수집 · 오디오 폐기`, bytes: result.bytes, mimeType: result.mimeType });
    }
  } catch (cause) { if (busy === run) failure(key, cause); }
  finally { finishRun(run); }
}
function releaseCapture(source) {
  if (busy?.kind !== 'capture' || (source !== 'screen-stop' && busy.source !== source)) return;
  (busy.key === 'speech' ? speech : microphone).release();
}
function cancelAll() {
  rabbit.cancel(); speech.cancel(); microphone.cancel();
  pointerId = null;
  keyHeld = false;
}

$('rabbit-text').addEventListener('click', () => runModel('rabbit', PROBE_TEST_TEXT));
$('rabbit-analyze').addEventListener('click', () => { if (transcript) runModel('analysis', transcript); });
$('capture-mode').addEventListener('change', render);
$('speech-language').addEventListener('change', () => {
  $('language-note').textContent = $('speech-language').value === ''
    ? '브라우저 기본 언어를 사용합니다. 자동 언어 감지를 켜는 옵션이 아닙니다. 원하는 언어가 인식되지 않으면 직접 선택해 주세요.'
    : '선택한 언어로 인식합니다. 래빗 기본 음성 인식이나 다국어 자동 감지 지원을 확인하는 검사는 아닙니다.';
});
const hold = $('capture-hold');
hold.addEventListener('pointerdown', event => {
  if (event.button !== 0 || busy || pointerId !== null) return;
  event.preventDefault();
  pointerId = event.pointerId;
  counts.screen.press++;
  try { hold.setPointerCapture(pointerId); } catch {}
  startCapture('screen');
});
hold.addEventListener('pointerup', event => {
  if (event.pointerId !== pointerId) return;
  pointerId = null;
  counts.screen.release++;
  releaseCapture('screen');
  updateCapabilities();
});
const cancelPointer = event => {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  counts.screen.cancel++;
  if (busy?.source === 'screen') cancelAll();
  updateCapabilities();
};
hold.addEventListener('pointercancel', cancelPointer);
hold.addEventListener('lostpointercapture', cancelPointer);
hold.addEventListener('contextmenu', event => event.preventDefault());
// Assistive technology activates a button with a click, without pointer/key events.
hold.addEventListener('click', event => {
  if (event.detail !== 0 || keyHeld || pointerId !== null) return;
  if (busy?.source === 'assistive') { counts.screen.release++; releaseCapture('assistive'); }
  else if (!busy) { counts.screen.press++; startCapture('assistive'); }
  updateCapabilities();
});
hold.addEventListener('keydown', event => {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (event.repeat || busy || keyHeld) return;
  keyHeld = true;
  counts.screen.press++;
  startCapture('keyboard');
});
hold.addEventListener('keyup', event => {
  if (![' ', 'Enter'].includes(event.key) || !keyHeld) return;
  event.preventDefault();
  keyHeld = false;
  counts.screen.release++;
  releaseCapture('keyboard');
  updateCapabilities();
});
hold.addEventListener('blur', () => { if (keyHeld) { keyHeld = false; cancelAll(); } });
$('capture-release').addEventListener('click', () => releaseCapture('screen-stop'));
$('cancel-test').addEventListener('click', () => { counts.screen.cancel++; cancelAll(); updateCapabilities(); });
window.addEventListener('longPressStart', () => {
  counts.hardware.longPressStart++;
  updateCapabilities();
  startCapture('hardware');
});
window.addEventListener('longPressEnd', () => {
  counts.hardware.longPressEnd++;
  releaseCapture('hardware');
  updateCapabilities();
});
window.addEventListener('sideClick', () => { counts.hardware.sideClick++; updateCapabilities(); });
for (const [type, delta] of [['scrollUp', -72], ['scrollDown', 72]]) {
  window.addEventListener(type, () => { counts.hardware[type]++; window.scrollBy({ top: delta, behavior: 'auto' }); });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelAll(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAll(); else updateCapabilities(); });
window.addEventListener('pagehide', cancelAll);
document.querySelectorAll('a[href="./"]').forEach(link => link.addEventListener('click', cancelAll));

function safeEnvironment() {
  const ua = String(navigator.userAgent || '').slice(0, 1000);
  const browser = ua.match(/(?:Edg|Chrome|Firefox|Version)\/\d+(?:\.\d+){0,3}/)?.[0] || 'unknown';
  const platform = /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'unknown';
  const language = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(navigator.language || '') ? navigator.language : 'unknown';
  return { browser, platform, language };
}
function report() {
  const tests = Object.fromEntries(Object.entries(results).map(([key, result]) => [key, {
    state: result.state, code: result.code, attempts: result.attempts, durationMs: result.durationMs,
    outputChars: result.outputChars, ...(key === 'speech' ? { requestedLanguage: speechSelection || 'browser-default' } : {}),
    ...(key === 'microphone' && result.bytes ? { bytes: result.bytes, mimeType: /^audio\/[a-z0-9.+-]+(?:;codecs=[a-z0-9.+-]+)?$/i.test(result.mimeType) ? result.mimeType : 'unknown' } : {}),
    ...(result.uncorrelatedResponses ? { uncorrelatedResponses: result.uncorrelatedResponses } : {}),
  }]));
  return JSON.stringify({ version: VERSION, environment: safeEnvironment(), capabilities: capabilities(), inputCounts: counts, tests,
    scope: 'Browser speech and Rabbit text AI only; native speech, language auto detection and music playback not verified.',
    excludes: ['transcripts', 'artist', 'title', 'rawModelResponses', 'audio', 'accountData'] }, null, 2);
}
$('copy-report').addEventListener('click', async () => {
  const value = report();
  $('report').value = value;
  $('report').hidden = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('unavailable');
    await navigator.clipboard.writeText(value);
    $('copy-status').textContent = '진단 결과를 복사했습니다. 이 채팅에 붙여 넣어 주세요.';
  } catch {
    $('copy-status').textContent = '자동 복사를 사용할 수 없습니다. 아래 결과를 길게 눌러 선택·복사하거나 화면의 단계별 결과를 알려 주세요.';
    $('report').focus();
    $('report').select();
  }
});
render();
