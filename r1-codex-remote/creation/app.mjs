// SDK 이벤트와 브라우저 조작을 분리하여 실기 통과를 추정하지 않습니다.
import { Ptt } from './ptt.mjs';
const $ = id => document.getElementById(id);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let socket, connected = false, epoch = 0, releasedAt = 0, heartbeatTimer;
const counts = { sdk: { start: 0, end: 0, click: 0 }, browser: { start: 0, end: 0, click: 0 } };
const evidence = { sdkEvents: [], bridge: [], speech: [], microphone: [], cancellations: [] };
let quotaFingerprint = '';
let sessions = [], selectedSession = null, sessionFingerprint = '';

function showResponse(id) {
  selectedSession = id; ptt.cancel(); $('home').hidden = true; $('diagnostic').hidden = true; $('response').hidden = false;
  const row = sessions.find(item => item.id === id);
  $('response-name').textContent = row?.name || '세션';
  $('response-status').textContent = row?.status || '상태 미확인';
  const top = window.scrollY; $('response-text').textContent = row?.reply || '아직 실시간 응답이 없습니다.'; window.scrollTo(0, top);
}
function renderSessions(state) {
  const fingerprint = JSON.stringify(state.sessions);
  if (fingerprint === sessionFingerprint) return;
  sessionFingerprint = fingerprint; sessions = state.sessions || [];
  $('session-list').replaceChildren();
  $('session-summary').textContent = state.sessions === null ? '실시간 세션 연결이 필요합니다.' : sessions.length ? '' : '공유 서버에 연결된 세션이 없습니다.';
  for (const row of sessions) {
    const button = document.createElement('button'); button.className = 'session-row';
    const name = document.createElement('span'), status = document.createElement('span'); name.textContent = row.name; status.textContent = row.status;
    button.append(name, status); button.onclick = () => { window.scrollTo(0, 0); showResponse(row.id); }; $('session-list').append(button);
  }
  if (!$('response').hidden && selectedSession) showResponse(selectedSession);
}

export function renderState(state) {
  renderSessions(state);
  const quota = state.quota || { status: 'unavailable', windows: [] };
  const fingerprint = JSON.stringify(quota);
  if (fingerprint === quotaFingerprint) return;
  quotaFingerprint = fingerprint;
  const container = $('quota-windows'); container.replaceChildren();
  container.classList.toggle('multiple', quota.windows.length > 1);
  for (const window of quota.windows) {
    const card = document.createElement('div'); card.className = 'quota-card';
    const label = document.createElement('span'), number = document.createElement('output'), reset = document.createElement('span');
    const minutes = window.windowDurationMins;
    label.textContent = minutes ? (minutes % 1440 === 0 ? `${minutes / 1440}일 한도` : minutes % 60 === 0 ? `${minutes / 60}시간 한도` : `${minutes}분 한도`) : '사용 한도';
    number.className = 'quota-number'; number.textContent = window.remainingPercent === null ? '확인 불가' : `${Math.round(window.remainingPercent * 10) / 10}%`;
    card.classList.toggle('unknown', window.remainingPercent === null);
    reset.className = 'quota-reset'; reset.textContent = window.resetsAt ? `초기화 ${new Date(window.resetsAt * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` : '초기화 시각 미제공';
    card.append(label, number, reset);
    if (window.remainingPercent !== null) {
      const meter = document.createElement('meter'); meter.min = 0; meter.max = 100; meter.value = window.remainingPercent; meter.setAttribute('aria-label', label.textContent + ' 잔여 비율'); card.append(meter);
    }
    container.append(card);
  }
  if (!quota.windows.length) {
    const message = document.createElement('p'); message.textContent = quota.status === 'loading' ? '사용 한도를 확인 중입니다.' : '사용 한도를 확인할 수 없습니다.'; container.append(message);
  }
  $('quota-updated').textContent = quota.checkedAt ? `${quota.status === 'stale' ? '마지막 확인' : '갱신'} ${new Date(quota.checkedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })}` : '갱신 정보 없음';
}
function showDiagnostic(show) {
  ptt.cancel(); $('home').hidden = show; $('diagnostic').hidden = !show; $('response').hidden = true; window.scrollTo(0, 0);
}

function log(message) {
  const item = document.createElement('li'); item.textContent = message;
  $('events').prepend(item);
  while ($('events').children.length > 12) $('events').lastChild.remove();
}
function mark(kind, value) {
  evidence[kind].push({ time: new Date().toISOString(), environment: $('test-environment').value, ...value });
  if (evidence[kind].length > 100) evidence[kind].shift();
}
function networkLost(message) {
  clearTimeout(heartbeatTimer);
  connected = false; ptt.cancel('연결이 끊겨 음성 입력을 중지하였습니다.');
  $('network').textContent = message;
  $('home-connection').textContent = '연결 끊김';
}
async function api(path, data) {
  // 이전 WebView에서도 요청과 응답 본문의 8초 제한을 유지합니다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store',
      signal: controller.signal,
      ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(typeof result.detail === 'string' ? result.detail : '통신에 실패했습니다.');
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('PC 응답 대기 시간이 초과되었습니다. 다시 연결해 주세요.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function connectSocket() {
  clearTimeout(heartbeatTimer);
  const generation = ++epoch;
  socket?.close();
  const url = new URL('/api/events', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = socket = new WebSocket(url);
  ws.onmessage = event => {
    if (generation !== epoch) return;
    try {
      const data = JSON.parse(event.data);
      if (data.kind !== 'diagnostic.snapshot') throw new Error();
      connected = true;
      $('home-connection').textContent = 'PC 연결';
      renderState(data.state);
      clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => { networkLost('브리지 응답이 끊겼습니다. 음성 입력을 중지하였습니다.'); ws.close(); }, 5000);
      $('network').textContent = `${url.protocol === 'wss:' ? 'WSS' : '로컬 WS'} 수신 · Codex 연결 미증명`;
      if (data.sequence === 1) mark('bridge', { transport: url.protocol, kind: data.kind, hostId: data.state.hostId });
    } catch { networkLost('진단 응답 형식이 올바르지 않습니다.'); ws.close(); }
  };
  ws.onclose = () => { if (generation === epoch) networkLost('브리지 연결이 끊겼습니다. 다시 연결해 주세요.'); };
  ws.onerror = () => { if (generation === epoch) networkLost('브리지 연결에 실패했습니다.'); };
}

async function openSpeech(callbacks) {
  if (!window.isSecureContext || !Recognition) throw new Error('unsupported');
  const recognition = new Recognition(), finals = new Map();
  recognition.lang = 'ko-KR'; recognition.interimResults = true; recognition.continuous = true;
  recognition.onresult = event => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finals.set(i, event.results[i][0].transcript);
    }
    callbacks.final([...finals.values()].join(' ').trim());
  };
  recognition.onerror = event => callbacks.error(`음성 인식 오류가 발생했습니다: ${event.error}`);
  recognition.onend = () => callbacks.end();
  recognition.start();
  return { stop: () => recognition.stop(), abort: () => recognition.abort() };
}
async function openMicrophone(callbacks) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder, bytes = 0;
  const close = () => stream.getTracks().forEach(track => track.stop());
  try {
    if (!window.MediaRecorder) throw new Error('unsupported');
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = event => { bytes += event.data.size; };
    recorder.onerror = () => { close(); callbacks.error('녹음 중 오류가 발생했습니다.'); };
    recorder.onstop = () => {
      close(); mark('microphone', { bytes, mimeType: recorder.mimeType, tracksEnded: stream.getTracks().every(t => t.readyState === 'ended') });
      log(`녹음 ${bytes}바이트 · 마이크 종료 확인`); callbacks.end();
    };
    recorder.start();
    const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); close(); };
    return { stop, abort: stop };
  } catch (error) { close(); throw error; }
}
const ptt = new Ptt({
  open: callbacks => $('mode').value === 'speech' ? openSpeech(callbacks) : openMicrophone(callbacks),
  report: event => {
    const labels = { listening: '듣는 중입니다.', finalizing: '녹음을 종료하고 최종 결과를 기다립니다.',
      final: '최종 문장이 표시되었습니다. Codex에는 전송하지 않았습니다.',
      empty: '인식 문장이 없습니다. 전송하지 않았습니다.', cancelled: event.message };
    $('microphone').textContent = labels[event.kind];
    if (event.kind === 'listening') $('transcript').textContent = '';
    if (event.kind === 'final') {
      $('transcript').textContent = event.text;
      // 문장과 녹음 원본은 결과 파일이나 서버 로그에 포함하지 않습니다.
      mark('speech', { engine: 'WebSpeech', lang: 'ko-KR', finalCharacters: event.text.length, sentToCodex: false });
    }
    if (event.kind === 'cancelled') mark('cancellations', { reason: event.message });
  },
});
function button(kind, source) {
  counts[source][kind]++;
  if (source === 'sdk') mark('sdkEvents', { event: kind });
  $('counts').textContent = `SDK 시작/종료/클릭 ${Object.values(counts.sdk).join('/')} · 브라우저 ${Object.values(counts.browser).join('/')}`;
  if (kind === 'start') {
    if ($('diagnostic').hidden) return;
    if (!connected) { log('브리지 연결 후 입력을 시험해 주세요.'); return; }
    ptt.maxMs = Math.min(60, Math.max(5, Number($('max-seconds').value) || 30)) * 1000;
    ptt.start();
  }
  if (kind === 'end') { releasedAt = performance.now(); ptt.release(); }
  if (kind === 'click') log(ptt.current || performance.now() - releasedAt < 500 ? '긴 누름 뒤 클릭을 무시하였습니다.' : '단일 클릭이 감지되었습니다.');
}
for (const [event, kind] of [['longPressStart', 'start'], ['longPressEnd', 'end'], ['sideClick', 'click']]) {
  window.addEventListener(event, () => button(kind, 'sdk'));
}
$('ptt').addEventListener('pointerdown', event => { $('ptt').setPointerCapture(event.pointerId); button('start', 'browser'); });
$('ptt').addEventListener('pointerup', () => button('end', 'browser'));
$('ptt').addEventListener('pointercancel', () => ptt.cancel());
$('ptt').addEventListener('lostpointercapture', () => { if (ptt.current && !ptt.current.released) ptt.cancel(); });
$('ptt').addEventListener('keydown', event => { if (event.code === 'Space' && !event.repeat) { event.preventDefault(); button('start', 'browser'); } });
$('ptt').addEventListener('keyup', event => { if (event.code === 'Space') { event.preventDefault(); button('end', 'browser'); } });
$('cancel').onclick = () => ptt.cancel();
$('show-diagnostic').onclick = () => showDiagnostic(true);
$('show-home').onclick = () => showDiagnostic(false);
$('response-back').onclick = () => showDiagnostic(false);
$('mode').onchange = () => ptt.cancel('시험 방식 변경으로 음성 입력이 취소되었습니다.');
$('test-environment').onchange = () => {
  ptt.cancel(); $('environment').textContent = $('test-environment').value === 'r1' ? 'r1 실기 선택 · 통과 미확인' : '브라우저 · 실기 미검증';
};
document.addEventListener('visibilitychange', () => { if (document.hidden) ptt.cancel('앱 비활성화로 음성 입력이 취소되었습니다.'); });
window.addEventListener('offline', () => networkLost('네트워크가 끊겼습니다.'));
window.addEventListener('pagehide', () => { ptt.cancel(); socket?.close(); });
// 홈에서는 목록을, 상세 화면에서는 본문을 휠로 탐색합니다.
const wheelTarget = () => $('home').hidden ? window : document.querySelector('.session-overview');
window.addEventListener('scrollUp', () => wheelTarget().scrollBy(0, -100));
window.addEventListener('scrollDown', () => wheelTarget().scrollBy(0, 100));
$('pair-form').onsubmit = async event => {
  event.preventDefault();
  try { await api('/api/pair', { code: $('pair-code').value }); $('pair-code').value = ''; connectSocket(); }
  catch (error) { networkLost(error.message); }
};
$('ping').onclick = async () => {
  try {
    const started = performance.now(), requestId = crypto.randomUUID();
    const data = await api('/api/diagnostic/ping', { requestId });
    if (data.requestId !== requestId || data.kind !== 'diagnostic.echo') throw new Error('진단 응답이 일치하지 않습니다.');
    const latencyMs = Math.round(performance.now() - started);
    mark('bridge', { transport: location.protocol, requestId, latencyMs, hostId: data.hostId });
    log(`PC 진단 왕복 ${latencyMs}ms · Codex 응답이 아닙니다.`);
  } catch (error) { networkLost(error.message); }
};
$('unpair').onclick = async () => {
  ptt.cancel();
  try { await api('/api/unpair', {}); epoch++; socket?.close(); networkLost('기기 연결이 해제되었습니다.'); }
  catch (error) { networkLost(error.message); }
};
$('export').onclick = () => {
  const report = { createdAt: new Date().toISOString(), environment: $('test-environment').value,
    viewport: { width: innerWidth, height: innerHeight }, secureContext: isSecureContext,
    capabilities: { webSpeech: !!Recognition, microphone: !!navigator.mediaDevices?.getUserMedia, mediaRecorder: !!window.MediaRecorder, nativeStt: 'unverified' },
    counts, evidence, sameServerSameThreadProven: false, commandDeliveryEnabled: false, devicePass: 'manual_verification_required' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'r1-diagnostic-result.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('capabilities').textContent = `보안 화면: ${isSecureContext ? '예' : '아니요'} / Web Speech: ${Recognition ? '제공됨·인식 미검증' : '없음'} / 마이크: ${navigator.mediaDevices?.getUserMedia ? '제공됨·권한 미검증' : '없음'}`;
// 재접속 때 이전 음성을 재전송하지 않고 저장된 Cookie 권한만 확인합니다.
api('/api/state').then(state => { renderState(state); connectSocket(); }).catch(() => {});
