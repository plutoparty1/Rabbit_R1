import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController, exactVoiceTrack, MAX_RECORDING_MS, RECORDER_START_TIMEOUT_MS, createKeylessTranscriber } from '../dist/voice.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const song = (id = 'a', name = '밤편지', artist = '아이유') => ({ id: id.repeat(22), uri: 'spotify:track:' + id.repeat(22), name, artists: [{ name: artist }] });
function fixture(options = {}) {
  const calls = [], timers = new Map(), changes = [], recorders = [];
  let stopped = 0, captures = 0, timerId = 0;
  const makeStream = () => {
    const track = Object.assign(new EventTarget(), { kind: 'audio', enabled: true, readyState: 'live', stop() { stopped++; this.readyState = 'ended'; } });
    return { get active() { return track.readyState === 'live'; }, getTracks: () => [track], getAudioTracks: () => [track] };
  };
  const stream = makeStream();
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, config) { this.stream = stream; this.state = 'inactive'; this.mimeType = config.mimeType; recorders.push(this); }
    start() { this.state = 'recording'; queueMicrotask(() => this.onstart?.()); }
    pause() { this.state = 'paused'; queueMicrotask(() => this.onpause?.()); }
    resume() { this.state = 'recording'; queueMicrotask(() => this.onresume?.()); }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) }); this.onstop?.(); });
    }
  }
  const client = {
    async voiceAccessToken() { calls.push('token'); return 'mock-token'; },
    async searchTracks(query) { calls.push(['search', query]); return [song()]; },
    async playTrack(...args) { calls.push(['play', ...args]); },
    ...options.client,
  };
  const controller = new VoiceController({ client,
    onChange(state) { changes.push(state); },
    mediaDevices: { getUserMedia: () => { captures++; return options.permission || Promise.resolve(captures === 1 ? stream : makeStream()); } },
    Recorder, deviceId: () => 'test-device',
    fetcher: async (url, init) => {
      calls.push([url, init]);
      if (url.endsWith('/config')) return { ok: true, json: async () => ({ enabled: options.enabled !== false }) };
      if (options.response) return options.response;
      return { ok: true, json: async () => ({ transcript: '아이유의 밤편지 틀어줘', language: 'ko', artist: '아이유', title: '밤편지' }) };
    },
    setTimer: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimer: id => timers.delete(id),
    ...options.controller,
  });
  return { controller, calls, timers, recorders, changes, stream, makeStream, stopped: () => stopped, captures: () => captures,
    fire(ms) { for (const [id, timer] of timers) if (timer.ms === ms) { timers.delete(id); timer.fn(); return; } throw new Error('No timer for ' + ms); },
  };
}
async function submit(f) { await f.controller.begin(); f.controller.release(); for (let i = 0; i < 6; i++) await tick(); }

test('no capture before input; release sends authorized audio then one exact playback', async () => {
  const f = fixture(); assert.equal(f.captures(), 0); assert.equal(f.calls.length, 0);
  await submit(f);
  assert.equal(f.stopped(), 0); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
  const upload = f.calls.find(call => call[0] === '/api/voice/search')[1];
  assert.equal(upload.headers.Authorization, 'Bearer mock-token');
  assert.deepEqual(JSON.parse(upload.body), { audio: 'YXVkaW8=', mimeType: 'audio/webm;codecs=opus' });
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
  assert.equal(f.calls.find(call => call[0] === 'play')[2], 'test-device');
  assert.equal(f.controller.state.phase, 'done');
  assert.equal(f.controller.state.transcript, '아이유의 밤편지 틀어줘');
  assert.equal(f.timers.size, 0); assert.equal(f.controller.active, false);
});

test('release while permission is pending stops the eventual stream and never records', async () => {
  const permission = deferred(), f = fixture({ permission: permission.promise });
  const start = f.controller.begin(); await tick();
  assert.equal(f.captures(), 1); f.controller.release();
  permission.resolve(f.stream); await start;
  assert.equal(f.stopped(), 1); assert.equal(f.recorders.length, 0);
  assert.equal(f.calls.filter(call => call[0] === '/api/voice/search').length, 0);
  assert.equal(f.controller.active, false); assert.equal(f.timers.size, 0);
});

test('cancel during recorder activity discards the final chunk and keeps microphone muted', async () => {
  const f = fixture(); await f.controller.begin(); f.controller.cancel(); await tick();
  assert.equal(f.stopped(), 0); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
  assert.equal(f.calls.filter(call => call[0] === '/api/voice/search').length, 0);
  assert.equal(f.controller.state.phase, 'idle'); assert.equal(f.timers.size, 0);
});

test('late cancelled transcription cannot search or play and cannot replace a newer recording', async () => {
  const response = deferred(), f = fixture({ response: response.promise });
  await f.controller.begin(); f.controller.release(); await tick();
  const upload = f.calls.find(call => call[0] === '/api/voice/search')[1];
  f.controller.cancel(); assert.equal(upload.signal.aborted, true);
  await f.controller.begin();
  response.resolve({ ok: true, json: async () => ({ transcript: 'old', title: '밤편지', artist: '아이유' }) });
  await tick(); await tick();
  assert.equal(f.controller.state.phase, 'recording');
  assert.equal(f.calls.filter(call => call[0] === 'search' || call[0] === 'play').length, 0);
  f.controller.cancel();
});

test('cancel during Spotify search prevents eventual playback', async () => {
  const search = deferred(), f = fixture({ client: { searchTracks: () => search.promise } });
  await f.controller.begin(); f.controller.release(); await tick(); await tick();
  assert.equal(f.controller.state.phase, 'searching');
  f.controller.cancel(); search.resolve([song()]); await tick();
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 0);
});

test('maximum duration stops and submits once even if physical release arrives later', async () => {
  const f = fixture(); await f.controller.begin();
  assert.equal(MAX_RECORDING_MS, 60000);
  assert.equal([...f.timers.values()].some(timer => timer.ms === 15000), false);
  f.fire(MAX_RECORDING_MS); for (let i = 0; i < 6; i++) await tick();
  f.controller.release(); await tick();
  assert.equal(f.stopped(), 0); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
  assert.equal(f.calls.filter(call => call[0] === '/api/voice/search').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
});

test('recording size limit stops without uploading', async () => {
  const f = fixture({ controller: { maxBytes: 3 } });
  await f.controller.begin();
  f.recorders[0].ondataavailable({ data: new Blob(['1234']) }); await tick();
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.stopped(), 0);
  assert.equal(f.stream.getAudioTracks()[0].enabled, false);
  assert.equal(f.calls.filter(call => call[0] === '/api/voice/search').length, 0);
  assert.equal(f.timers.size, 0);
});

test('unconfigured server gives actionable feedback without prompting for microphone', async () => {
  const f = fixture({ enabled: false }); await f.controller.begin();
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.captures(), 0);
  assert.match(f.controller.state.message, /Gemini API/); assert.equal(f.timers.size, 0);
});

test('request timeout aborts and leaves an actionable error', async () => {
  const response = deferred(), f = fixture({ response: response.promise });
  await f.controller.begin(); f.controller.release(); await tick();
  f.fire(45000);
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.controller.active, false);
  assert.equal(f.calls.find(call => call[0] === '/api/voice/search')[1].signal.aborted, true);
  response.resolve({ ok: true, json: async () => ({ transcript: 'old', title: '밤편지', artist: '아이유' }) });
  await tick(); assert.equal(f.calls.filter(call => call[0] === 'play').length, 0);
});

test('exact title and artist normalization preserves versions and ambiguous matches need selection', () => {
  const tracks = [song('a', 'Cruel Summer', 'Taylor Swift')];
  assert.equal(exactVoiceTrack(tracks, { title: 'cruel-summer', artist: 'TaylorSwift' }), tracks[0]);
  assert.equal(exactVoiceTrack(tracks, { title: 'Cruel Summer (Live)', artist: 'Taylor Swift' }), null);
  assert.equal(exactVoiceTrack(tracks, { title: 'Cruel Summer', artist: '' }), null);
  assert.equal(exactVoiceTrack([...tracks, song('b', 'Cruel Summer', 'Taylor Swift')], { title: 'Cruel Summer', artist: 'Taylor Swift' }), null);
});

test('ambiguous candidates require explicit tap; duplicate taps cannot dispatch twice', async () => {
  const f = fixture({ client: { searchTracks: async () => [song(), song('b')] } });
  await submit(f); assert.equal(f.controller.state.phase, 'choosing');
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 0);
  const first = f.controller.choose(song().uri), second = f.controller.choose(song().uri);
  await Promise.all([first, second]);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
});

test('a playback failure is shown and never retried automatically', async () => {
  let plays = 0;
  const f = fixture({ client: { playTrack: async () => { plays++; throw new Error('Spotify 앱에서 곡을 먼저 재생해 주세요.'); } } });
  await submit(f); assert.equal(plays, 1); assert.equal(f.controller.state.phase, 'error');
  assert.equal(f.timers.size, 0); assert.equal(f.controller.active, false);
});

function keylessFixture(options = {}) {
  const calls = [];
  const recognizer = { ready: true, supported: true,
    async prepare() { calls.push(['prepare']); this.ready = true; },
    async transcribeBlob(blob, options) { calls.push(['audio', blob, options]); return { transcript: '아이유의 밤편지 틀어줘', lang: 'ko' }; },
    cancel() { calls.push(['cancel-local']); }, ...options.recognizer,
  };
  const rabbit = { supported: true,
    async request(text) { calls.push(['text', text]); return { artist: '아이유', title: '밤편지' }; },
    cancel() { calls.push(['cancel-rabbit']); }, ...options.rabbit,
  };
  const transcriber = createKeylessTranscriber(recognizer, rabbit);
  return { ...fixture({ controller: { transcriber }, ...options.fixture }), localCalls: calls, recognizer, rabbit };
}

test('clear keyless commands parse locally without a Rabbit round trip or paid route', async () => {
  const f = keylessFixture(); await submit(f);
  assert.equal(f.controller.state.phase, 'done');
  assert.equal(f.localCalls.filter(call => call[0] === 'audio').length, 1);
  assert.deepEqual(f.localCalls.find(call => call[0] === 'audio')[2], { lang: '' });
  assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
  assert.equal(f.calls.some(call => call === 'token' || call[0]?.startsWith('/api/voice')), false);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
  assert.equal(f.controller.state.language, 'ko');
});

test('keyless capture and search work without a Rabbit bridge', async () => {
  const f = keylessFixture({ rabbit: { supported: false, request() { throw Error('Rabbit must not be called'); } } });
  await submit(f);
  assert.equal(f.controller.state.phase, 'done'); assert.equal(f.captures(), 1);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
  assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
  assert.equal(f.timers.size, 0);
});

test('cold first hold records immediately while model loads, then processes after release', async () => {
  const model = deferred();
  const f = keylessFixture({ recognizer: { ready: false,
    prepare() { return model.promise; },
    async transcribeBlob() { await model.promise; return { transcript: '아이유의 밤편지 틀어줘', lang: 'ko' }; },
  } });
  await f.controller.begin();
  assert.equal(f.captures(), 1); assert.equal(f.controller.state.phase, 'recording');
  assert.equal(f.recognizer.ready, false); assert.equal(f.calls.length, 0);
  f.controller.release(); await tick();
  assert.equal(f.stopped(), 0); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
  assert.equal(f.controller.state.phase, 'transcribing');
  assert.match(f.controller.state.message, /녹음은 완료/);
  assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
  f.recognizer.ready = true; model.resolve();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(f.controller.state.phase, 'done');
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
  assert.equal(f.calls.some(call => call === 'token' || call[0]?.startsWith('/api/voice')), false);
});

test('closing a cold recording or idle panel preserves background preparation', async () => {
  const model = deferred();
  const f = keylessFixture({ recognizer: { ready: false, prepare: () => model.promise } });
  f.controller.cancel();
  await f.controller.begin(); f.controller.cancel(); await tick();
  assert.equal(f.stopped(), 0); assert.equal(f.stream.getAudioTracks()[0].enabled, false); assert.equal(f.calls.length, 0);
  assert.equal(f.localCalls.some(call => call[0].startsWith('cancel')), false);
  model.resolve(); await tick();
  assert.equal(f.controller.state.phase, 'idle');
});

test('warm successive holds reuse the model and do not cancel it on success or idle close', async () => {
  const f = keylessFixture();
  await submit(f); f.controller.cancel(); await submit(f);
  assert.equal(f.captures(), 1); assert.equal(f.stopped(), 0);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 2);
  assert.equal(f.localCalls.some(call => call[0].startsWith('cancel')), false);
});

test('recording readiness and duration start only at the recorder start event', async () => {
  const f = keylessFixture(), GoodRecorder = f.controller.Recorder, track = f.stream.getAudioTracks()[0];
  f.controller.Recorder = class extends GoodRecorder { start() { this.state = 'recording'; } };
  await f.controller.begin();
  assert.equal(f.controller.state.phase, 'preparing');
  assert.match(f.controller.state.message, /아직 말하지/);
  assert.equal(track.enabled, false);
  assert.equal([...f.timers.values()].some(timer => timer.ms === MAX_RECORDING_MS), false);
  assert.equal([...f.timers.values()].some(timer => timer.ms === RECORDER_START_TIMEOUT_MS), true);
  f.recorders[0].ondataavailable({ data: new Blob(['before-start']) });
  f.recorders[0].onstart();
  assert.equal(f.controller.state.phase, 'recording');
  assert.equal(f.controller.state.message, '지금 말하세요');
  assert.equal(track.enabled, true);
  assert.equal([...f.timers.values()].some(timer => timer.ms === RECORDER_START_TIMEOUT_MS), false);
  assert.equal([...f.timers.values()].some(timer => timer.ms === MAX_RECORDING_MS), true);
  f.controller.release();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(await f.localCalls.find(call => call[0] === 'audio')[1].text(), 'audio');
  assert.equal(f.controller.state.phase, 'done');
});

test('releasing or cancelling before recorder start cannot turn a later hold into recording', async () => {
  for (const operation of ['release', 'cancel', 'releaseMicrophone']) {
    const f = keylessFixture(), GoodRecorder = f.controller.Recorder, track = f.stream.getAudioTracks()[0];
    f.controller.Recorder = class extends GoodRecorder { start() { this.state = 'recording'; } };
    await f.controller.begin();
    const lateStart = f.recorders[0].onstart;
    f.controller[operation]();
    assert.equal(f.controller.state.phase, 'idle', operation);
    if (operation === 'release') assert.match(f.controller.state.message, /녹음 전에 버튼을 놓았습니다/);
    assert.equal(track.enabled, false, operation);
    assert.equal(f.recorders[0].state, 'inactive', operation);
    assert.equal(f.recorders[0].onstart, null, operation);
    assert.equal(f.controller.active, false, operation);
    assert.equal(f.timers.size, 0, operation);
    f.controller.Recorder = GoodRecorder;
    await f.controller.begin();
    const nextTrack = f.recorders[1].stream.getAudioTracks()[0];
    lateStart(); await tick();
    assert.equal(f.controller.state.phase, 'recording', operation);
    assert.equal(nextTrack.enabled, true, operation);
    assert.equal(f.captures(), operation === 'releaseMicrophone' ? 2 : 1, operation);
    assert.equal(f.localCalls.filter(call => call[0] === 'audio').length, 0, operation);
    f.controller.releaseMicrophone();
  }
});

test('a recorder that never starts times out and cannot signal readiness afterwards', async () => {
  const f = keylessFixture(), GoodRecorder = f.controller.Recorder;
  f.controller.Recorder = class extends GoodRecorder { start() { this.state = 'recording'; } };
  await f.controller.begin();
  const lateStart = f.recorders[0].onstart;
  f.fire(RECORDER_START_TIMEOUT_MS);
  assert.equal(f.controller.state.phase, 'error');
  assert.match(f.controller.state.message, /버튼을 놓고 다시/);
  assert.equal(f.controller.microphoneReady, false);
  assert.equal(f.controller.active, false);
  assert.equal(f.stream.getAudioTracks()[0].readyState, 'ended');
  assert.equal(f.timers.size, 0);
  lateStart(); await tick();
  assert.equal(f.controller.state.phase, 'error');
  assert.equal(f.localCalls.filter(call => call[0] === 'audio').length, 0);
  f.controller.Recorder = GoodRecorder;
  await f.controller.begin();
  assert.equal(f.captures(), 2); assert.equal(f.controller.state.phase, 'recording');
  f.controller.releaseMicrophone();
});

test('a dead microphone cannot emit a recording-ready state from a delayed start', async () => {
  const f = keylessFixture(), GoodRecorder = f.controller.Recorder;
  f.controller.Recorder = class extends GoodRecorder { start() { this.state = 'recording'; } };
  await f.controller.begin();
  f.stream.getAudioTracks()[0].readyState = 'ended';
  f.recorders[0].onstart();
  assert.equal(f.controller.state.phase, 'error');
  assert.equal(f.controller.microphoneReady, false);
  assert.equal(f.changes.some(state => state.phase === 'recording'), false);
  assert.equal(f.timers.size, 0);
});

test('three holds reuse one microphone, unmute only while recording, and keep audio separate', async () => {
  const f = keylessFixture(), track = f.stream.getAudioTracks()[0];
  assert.equal(f.captures(), 0); assert.equal(f.controller.microphoneReady, false);
  for (let hold = 1; hold <= 3; hold++) {
    await f.controller.begin();
    assert.equal(f.controller.state.phase, 'recording');
    assert.equal(f.controller.microphoneReady, true); assert.equal(track.enabled, true);
    assert.equal(f.recorders[hold - 1].stream, f.stream);
    f.recorders[hold - 1].ondataavailable({ data: new Blob([`hold${hold}`]) });
    f.controller.release();
    assert.equal(track.enabled, false); assert.equal(track.readyState, 'live');
    for (let i = 0; i < 6; i++) await tick();
    assert.equal(f.controller.state.phase, 'done'); assert.equal(track.enabled, false);
    f.controller.cancel();
    assert.equal(f.controller.microphoneReady, true); assert.equal(track.enabled, false);
  }
  assert.equal(f.captures(), 1); assert.equal(f.stopped(), 0); assert.equal(f.recorders.length, 3);
  const audio = await Promise.all(f.localCalls.filter(call => call[0] === 'audio').map(call => call[1].text()));
  assert.deepEqual(audio, ['hold1audio', 'hold2audio', 'hold3audio']);
});

test('closing a recording immediately allows a new hold without carrying discarded audio', async () => {
  const f = keylessFixture(), track = f.stream.getAudioTracks()[0];
  await f.controller.begin();
  f.recorders[0].ondataavailable({ data: new Blob(['discarded']) });
  f.controller.cancel();
  assert.equal(track.enabled, false); assert.equal(f.controller.microphoneReady, true);
  await f.controller.begin();
  assert.equal(track.enabled, true); assert.equal(f.captures(), 1);
  await tick();
  assert.equal(track.enabled, true); assert.equal(f.controller.state.phase, 'recording');
  f.controller.release();
  for (let i = 0; i < 6; i++) await tick();
  const audio = f.localCalls.filter(call => call[0] === 'audio');
  assert.equal(audio.length, 1); assert.equal(await audio[0][1].text(), 'audio');
});

test('an ended microphone is replaced on the next hold without reopening it in the background', async () => {
  const f = keylessFixture();
  await f.controller.begin(); f.controller.cancel();
  f.stream.getAudioTracks()[0].readyState = 'ended';
  assert.equal(f.controller.microphoneReady, false); assert.equal(f.captures(), 1);
  await f.controller.begin();
  assert.equal(f.captures(), 2); assert.equal(f.controller.microphoneReady, true);
  assert.notEqual(f.recorders[1].stream, f.stream);
  assert.equal(f.recorders[1].stream.getAudioTracks()[0].enabled, true);
  f.controller.cancel();
  assert.equal(f.recorders[1].stream.getAudioTracks()[0].enabled, false);
});

test('releasing the microphone closes idle and active capture and only a later hold reacquires it', async () => {
  const f = keylessFixture();
  await submit(f); f.controller.releaseMicrophone();
  assert.equal(f.controller.microphoneReady, false); assert.equal(f.stopped(), 1);
  assert.equal(f.stream.getAudioTracks()[0].enabled, false);
  await tick(); assert.equal(f.captures(), 1);
  await f.controller.begin();
  assert.equal(f.captures(), 2); assert.equal(f.controller.state.phase, 'recording');
  f.controller.releaseMicrophone(); await tick();
  assert.equal(f.stopped(), 2); assert.equal(f.controller.microphoneReady, false);
  assert.equal(f.controller.active, false); assert.equal(f.timers.size, 0);
  assert.equal(f.localCalls.filter(call => call[0] === 'audio').length, 1);
});

test('releasing the microphone discards a late permission grant even after the panel was already closed', async () => {
  for (const alreadyClosed of [false, true]) {
    const permission = deferred(), f = keylessFixture({ fixture: { permission: permission.promise } });
    const start = f.controller.begin(); await tick();
    if (alreadyClosed) f.controller.cancel();
    f.controller.releaseMicrophone();
    permission.resolve(f.stream); await start;
    assert.equal(f.stopped(), 1); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
    assert.equal(f.controller.microphoneReady, false); assert.equal(f.controller.active, false);
    assert.equal(f.recorders.length, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.localCalls.filter(call => call[0] === 'audio').length, 0);
  }
});

test('a permission grant from before teardown cannot disturb a newer recording', async () => {
  const pending = deferred(), f = keylessFixture();
  let captures = 0;
  const nextStream = f.makeStream();
  f.controller.mediaDevices = { getUserMedia: () => ++captures === 1 ? pending.promise : Promise.resolve(nextStream) };
  const oldStart = f.controller.begin(); await tick();
  f.controller.releaseMicrophone(); await f.controller.begin();
  pending.resolve(f.stream); await oldStart;
  assert.equal(f.stream.getAudioTracks()[0].readyState, 'ended');
  assert.equal(nextStream.getAudioTracks()[0].enabled, true);
  assert.equal(f.controller.microphoneReady, true); assert.equal(f.controller.state.phase, 'recording');
  f.controller.releaseMicrophone();
});

test('recorder construction and device failures invalidate capture so retry can reacquire', async () => {
  const f = keylessFixture(), GoodRecorder = f.controller.Recorder;
  f.controller.Recorder = class { constructor() { throw new Error('Recorder failed'); } };
  await f.controller.begin();
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.controller.microphoneReady, false);
  assert.equal(f.stopped(), 1); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
  f.controller.Recorder = GoodRecorder;
  await f.controller.begin();
  assert.equal(f.captures(), 2); assert.equal(f.controller.microphoneReady, true);
  f.recorders[0].onerror(); await tick();
  assert.equal(f.stopped(), 2); assert.equal(f.controller.microphoneReady, false);
  assert.equal(f.controller.state.phase, 'error');
  await f.controller.begin();
  assert.equal(f.captures(), 3); assert.equal(f.controller.state.phase, 'recording');
  f.controller.releaseMicrophone();
});

test('recorder start and stop failures never leave a live microphone cached', async () => {
  for (const operation of ['start', 'release', 'cancel', 'stop-timeout']) {
    const f = keylessFixture(), GoodRecorder = f.controller.Recorder;
    if (operation === 'start') f.controller.Recorder = class extends GoodRecorder { start() { throw new Error('Start failed'); } };
    await f.controller.begin();
    if (operation === 'stop-timeout') {
      f.recorders[0].stop = function () { this.state = 'inactive'; };
      f.controller.release();
      assert.equal(f.stream.getAudioTracks()[0].enabled, false);
      f.fire(5000);
    } else if (operation !== 'start') {
      f.recorders[0].stop = () => { throw new Error('Stop failed'); };
      f.controller[operation]();
    }
    assert.equal(f.stopped(), 1, operation); assert.equal(f.controller.microphoneReady, false, operation);
    assert.equal(f.controller.active, false, operation); assert.equal(f.timers.size, 0, operation);
    assert.equal(f.stream.getAudioTracks()[0].enabled, false, operation);
    f.controller.Recorder = GoodRecorder;
    await f.controller.begin();
    assert.equal(f.captures(), 2, operation); assert.equal(f.controller.state.phase, 'recording', operation);
    f.controller.releaseMicrophone();
  }
});

test('cancel after release while the cold model is loading ignores its eventual result', async () => {
  const model = deferred();
  const f = keylessFixture({ recognizer: { ready: false,
    prepare: () => model.promise,
    async transcribeBlob() { await model.promise; return { transcript: 'late', lang: 'ko' }; },
  } });
  await f.controller.begin(); f.controller.release(); await tick();
  f.controller.cancel(); model.resolve(); await tick(); await tick();
  assert.ok(f.localCalls.some(call => call[0] === 'cancel-local'));
  assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
  assert.equal(f.calls.length, 0); assert.equal(f.controller.state.phase, 'idle');
});

test('cancel during local transcription rejects a late result before calling Rabbit or Spotify', async () => {
  const result = deferred();
  const f = keylessFixture({ recognizer: { transcribeBlob: () => result.promise } });
  await f.controller.begin(); f.controller.release(); await tick();
  f.controller.cancel(); result.resolve({ transcript: 'late', lang: 'en' }); await tick(); await tick();
  assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
  assert.ok(f.localCalls.some(call => call[0] === 'cancel-local'));
  assert.equal(f.localCalls.some(call => call[0] === 'cancel-rabbit'), false);
  assert.equal(f.calls.length, 0); assert.equal(f.controller.state.phase, 'idle');
});

test('cancelling an unstructured local search suppresses late candidates and playback', async () => {
  const result = deferred();
  const f = keylessFixture({
    recognizer: { async transcribeBlob() { return { transcript: '아이유 밤편지 틀어줘', lang: 'ko' }; } },
    fixture: { client: { async searchTracks(request) { assert.equal(request.query, '아이유 밤편지'); return result.promise; } } },
  });
  await f.controller.begin(); f.controller.release(); await tick(); await tick();
  assert.equal(f.controller.state.phase, 'searching');
  f.controller.cancel(); result.resolve([song()]); await tick();
  assert.equal(f.calls.length, 0); assert.equal(f.controller.state.phase, 'idle');
  assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
});

test('local model failure is actionable and never falls back to paid transcription', async () => {
  const f = keylessFixture({ recognizer: { async transcribeBlob() { throw Object.assign(new Error('runtime details'), { code: 'local_transcription_timeout' }); } } });
  await submit(f);
  assert.equal(f.controller.state.phase, 'error'); assert.match(f.controller.state.message, /시간이 초과/);
  assert.equal(f.calls.length, 0); assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
});

test('unstructured speech searches Spotify directly and requires a choice without Rabbit or paid requests', async () => {
  const f = keylessFixture({ recognizer: { async transcribeBlob() { return { transcript: '아이유 밤편지 틀어줘', lang: 'ko' }; } }, rabbit: { supported: false, request() { throw Error('Rabbit must not be called'); } } });
  await submit(f);
  assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
  const request = f.calls.find(call => call[0] === 'search')[1];
  assert.equal(request.query, '아이유 밤편지');
  assert.equal(request.artist, '');
  assert.equal(f.controller.state.phase, 'choosing');
  assert.equal(f.calls.some(call => call[0] === 'play'), false);
  assert.equal(f.calls.some(call => call === 'token' || call[0]?.startsWith('/api/voice')), false);
  await f.controller.choose(song().uri);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
});

test('uncertain parsed requests require a choice even with one exact Spotify result', async () => {
  const f = keylessFixture({ recognizer: { async transcribeBlob() { return { transcript: '아이유의 밤편지', lang: 'ko' }; } } });
  await submit(f);
  assert.equal(f.controller.state.phase, 'choosing');
  assert.equal(f.calls.some(call => call[0] === 'play'), false);
  assert.match(f.controller.state.message, /후보/);
});

test('artist recovery results never autoplay even if one title and artist happen to match', async () => {
  const f = keylessFixture({ fixture: { client: { async searchTracks() { return [{ ...song(), voiceRecovery: true }]; } } } });
  await submit(f);
  assert.equal(f.controller.state.phase, 'choosing');
  assert.equal(f.calls.some(call => call[0] === 'play'), false);
  await f.controller.choose(song().uri);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
});

test('invalid local recognition responses do not report a Rabbit AI failure', async () => {
  const f = keylessFixture({ recognizer: { async transcribeBlob() { throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' }); } } });
  await submit(f);
  assert.equal(f.controller.state.phase, 'error');
  assert.match(f.controller.state.message, /녹음/);
  assert.doesNotMatch(f.controller.state.message, /래빗 AI/);
  assert.equal(f.calls.length, 0);
});

function startupFixture(options) {
  const f = keylessFixture(options); f.controller.requirePreparedMicrophone = true;
  f.preparationChanges = []; f.controller.onPreparationChange = state => f.preparationChanges.push(state);
  return f;
}

test('startup prepares one paused recorder with a ready source but no held session or transcription', async () => {
  const f = startupFixture();
  const first = f.controller.prepareMicrophone(), second = f.controller.prepareMicrophone();
  assert.equal(first, second); assert.equal(f.controller.microphonePreparing, true);
  assert.equal(await first, true);
  assert.equal(f.controller.microphoneReady, true); assert.equal(f.controller.active, false);
  assert.equal(f.recorders[0].state, 'paused'); assert.equal(f.stream.getAudioTracks()[0].enabled, true);
  assert.deepEqual(f.localCalls, []); assert.equal(f.captures(), 1);
  assert.deepEqual(f.preparationChanges.map(state => state.phase), ['preparing', 'ready']);
  f.controller.releaseMicrophone(); assert.equal(f.timers.size, 0);
});

test('a press during startup returns immediately and cannot turn into a late recording', async () => {
  const permission = deferred(), f = startupFixture({ fixture: { permission: permission.promise } });
  const preparation = f.controller.prepareMicrophone();
  assert.equal(await f.controller.begin(), false); assert.equal(f.controller.active, false);
  f.controller.release(); f.controller.cancel();
  permission.resolve(f.stream); assert.equal(await preparation, true);
  assert.equal(f.controller.microphoneReady, true); assert.equal(f.controller.active, false);
  assert.equal(f.recorders[0].state, 'paused'); assert.equal(f.stream.getAudioTracks()[0].enabled, true);
  assert.equal(f.changes.some(state => state.phase === 'recording'), false);
  f.controller.releaseMicrophone();
});

test('three startup-prepared holds reuse the stream and keep startup header chunks per utterance', async () => {
  const f = startupFixture(); await f.controller.prepareMicrophone();
  for (let hold = 0; hold < 3; hold++) {
    const recorder = f.controller.preparedMicrophone.recorder;
    recorder.ondataavailable({ data: new Blob([`header${hold}`]) });
    assert.equal(await f.controller.begin(), true);
    assert.equal(f.controller.state.phase, 'recording'); assert.equal(f.stream.getAudioTracks()[0].enabled, true);
    recorder.ondataavailable({ data: new Blob([`hold${hold}`]) });
    f.controller.release(); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
    for (let i = 0; i < 6; i++) await tick();
    assert.equal(f.controller.state.phase, 'done'); assert.equal(f.controller.microphoneReady, true);
    assert.equal(f.controller.preparedMicrophone.recorder.state, 'paused');
  }
  assert.equal(f.captures(), 1); assert.equal(f.recorders.length, 4);
  assert.deepEqual(await Promise.all(f.localCalls.filter(call => call[0] === 'audio').map(call => call[1].text())), ['header0hold0audio', 'header1hold1audio', 'header2hold2audio']);
  f.controller.releaseMicrophone(); assert.equal(f.timers.size, 0);
});

test('startup waits for the pause event and times out without falsely announcing readiness', async () => {
  for (const operation of ['start', 'pause']) {
    const f = startupFixture(), GoodRecorder = f.controller.Recorder;
    f.controller.Recorder = class extends GoodRecorder {
      start() { this.state = 'recording'; if (operation !== 'start') queueMicrotask(() => this.onstart?.()); }
      pause() { this.state = 'paused'; }
    };
    const pending = f.controller.prepareMicrophone(); await tick();
    const late = operation === 'start' ? f.recorders[0].onstart : f.recorders[0].onpause;
    assert.equal(f.controller.microphoneReady, false); assert.equal(f.stream.getAudioTracks()[0].enabled, false);
    f.fire(RECORDER_START_TIMEOUT_MS); assert.equal(await pending, false);
    late(); await tick();
    assert.equal(f.controller.preparationState.phase, 'error'); assert.equal(f.controller.microphoneReady, false);
    assert.equal(f.controller.active, false); assert.equal(f.stream.getAudioTracks()[0].readyState, 'ended');
    assert.equal(f.timers.size, 0);
  }
});

test('cancelling a pending resume ignores late events and rearms independently', async () => {
  const f = startupFixture(); await f.controller.prepareMicrophone();
  const old = f.controller.preparedMicrophone.recorder;
  old.resume = function () { this.state = 'recording'; };
  await f.controller.begin(); const lateResume = old.onresume;
  f.controller.cancel(); await tick();
  assert.equal(f.controller.microphoneReady, true); assert.equal(f.stream.getAudioTracks()[0].enabled, true);
  await f.controller.begin(); lateResume(); await tick();
  assert.equal(f.controller.state.phase, 'recording'); assert.equal(f.stream.getAudioTracks()[0].enabled, true);
  assert.equal(f.localCalls.filter(call => call[0] === 'audio').length, 0);
  f.controller.releaseMicrophone(); assert.equal(f.timers.size, 0);
});

test('startup teardown rejects late grants and does not rearm until explicit foreground preparation', async () => {
  const permission = deferred(), f = startupFixture({ fixture: { permission: permission.promise } });
  const first = f.controller.prepareMicrophone(); f.controller.releaseMicrophone();
  assert.equal(await first, false); assert.equal(f.controller.microphonePreparing, false);
  permission.resolve(f.stream); await tick();
  assert.equal(f.stream.getAudioTracks()[0].readyState, 'ended'); assert.equal(f.recorders.length, 0);
  assert.equal(f.controller.preparationState.phase, 'idle'); assert.equal(f.timers.size, 0);
  const newStream = f.makeStream(); f.controller.mediaDevices.getUserMedia = async () => newStream;
  assert.equal(await f.controller.prepareMicrophone(), true);
  f.controller.releaseMicrophone(); await tick();
  assert.equal(f.recorders.length, 1); assert.equal(newStream.getAudioTracks()[0].readyState, 'ended');
});

test('an ended idle track invalidates startup readiness without retry loops', async () => {
  const f = startupFixture(); await f.controller.prepareMicrophone();
  const track = f.stream.getAudioTracks()[0]; track.readyState = 'ended'; track.dispatchEvent(new Event('ended'));
  assert.equal(f.controller.microphoneReady, false); assert.equal(f.controller.preparationState.phase, 'error');
  await tick(); assert.equal(f.captures(), 1); assert.equal(f.controller.active, false);
  assert.equal(await f.controller.prepareMicrophone(), true); assert.equal(f.captures(), 2);
  f.controller.releaseMicrophone();
});

test('failed permission preparation is retryable by a tap and never opens a held session', async () => {
  const f = startupFixture();
  f.controller.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('private browser error'), { name: 'NotAllowedError' }); };
  assert.equal(await f.controller.prepareMicrophone(), false); assert.match(f.controller.preparationState.message, /마이크 권한/);
  assert.doesNotMatch(f.controller.preparationState.message, /private/);
  assert.equal(await f.controller.begin(), false); assert.equal(f.controller.active, false);
  f.controller.mediaDevices.getUserMedia = async () => f.stream;
  assert.equal(await f.controller.prepareMicrophone(), true); f.controller.releaseMicrophone();
});

test('teardown during a prepared hold closes the source and cannot silently rearm', async () => {
  const f = startupFixture(); await f.controller.prepareMicrophone(); await f.controller.begin();
  assert.equal(f.stream.getAudioTracks()[0].enabled, true);
  f.controller.releaseMicrophone(); await tick();
  assert.equal(f.stream.getAudioTracks()[0].enabled, false); assert.equal(f.stream.getAudioTracks()[0].readyState, 'ended');
  assert.equal(f.controller.active, false); assert.equal(f.controller.microphonePreparing, false);
  assert.equal(f.controller.preparationState.phase, 'idle'); assert.equal(f.recorders.length, 1);
  assert.equal(f.localCalls.filter(call => call[0] === 'audio').length, 0); assert.equal(f.timers.size, 0);
});

test('a stale startup grant cannot replace or mute a newer prepared source', async () => {
  const f = startupFixture(), pending = deferred(), nextStream = f.makeStream(); let requests = 0;
  f.controller.mediaDevices.getUserMedia = () => ++requests === 1 ? pending.promise : Promise.resolve(nextStream);
  const old = f.controller.prepareMicrophone(); f.controller.releaseMicrophone();
  await f.controller.prepareMicrophone();
  pending.resolve(f.stream); await old; await tick();
  assert.equal(f.stream.getAudioTracks()[0].readyState, 'ended');
  assert.equal(f.controller.microphoneReady, true); assert.equal(nextStream.getAudioTracks()[0].enabled, true);
  assert.equal(nextStream.getAudioTracks()[0].readyState, 'live');
  f.controller.releaseMicrophone();
});
