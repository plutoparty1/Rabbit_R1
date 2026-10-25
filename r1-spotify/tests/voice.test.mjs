import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController, exactVoiceTrack, MAX_RECORDING_MS, createKeylessTranscriber } from '../dist/voice.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const song = (id = 'a', name = '밤편지', artist = '아이유') => ({ id: id.repeat(22), uri: 'spotify:track:' + id.repeat(22), name, artists: [{ name: artist }] });
function fixture(options = {}) {
  const calls = [], timers = new Map(), changes = [], recorders = [];
  let stopped = 0, captures = 0, timerId = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(_stream, config) { this.state = 'inactive'; this.mimeType = config.mimeType; recorders.push(this); }
    start() { this.state = 'recording'; }
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
    mediaDevices: { getUserMedia: () => { captures++; return options.permission || Promise.resolve(stream); } },
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
  return { controller, calls, timers, recorders, changes, stream, stopped: () => stopped, captures: () => captures,
    fire(ms) { for (const [id, timer] of timers) if (timer.ms === ms) { timers.delete(id); timer.fn(); return; } throw new Error('No timer for ' + ms); },
  };
}
async function submit(f) { await f.controller.begin(); f.controller.release(); for (let i = 0; i < 6; i++) await tick(); }

test('no capture before input; release sends authorized audio then one exact playback', async () => {
  const f = fixture(); assert.equal(f.captures(), 0); assert.equal(f.calls.length, 0);
  await submit(f);
  assert.equal(f.stopped(), 1);
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

test('cancel during recorder activity discards the final chunk and releases microphone', async () => {
  const f = fixture(); await f.controller.begin(); f.controller.cancel(); await tick();
  assert.equal(f.stopped(), 1);
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
  assert.equal(f.stopped(), 1);
  assert.equal(f.calls.filter(call => call[0] === '/api/voice/search').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1);
});

test('recording size limit stops without uploading', async () => {
  const f = fixture({ controller: { maxBytes: 3 } });
  await f.controller.begin();
  f.recorders[0].ondataavailable({ data: new Blob(['1234']) }); await tick();
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.stopped(), 1);
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

test('keyless route checks Rabbit bridge before microphone capture', async () => {
  const f = keylessFixture({ rabbit: { supported: false } }); await f.controller.begin();
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.captures(), 0);
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.localCalls.length, 0); assert.match(f.controller.state.message, /Creation/);
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
  assert.equal(f.stopped(), 1); assert.equal(f.controller.state.phase, 'transcribing');
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
  assert.equal(f.stopped(), 1); assert.equal(f.calls.length, 0);
  assert.equal(f.localCalls.some(call => call[0].startsWith('cancel')), false);
  model.resolve(); await tick();
  assert.equal(f.controller.state.phase, 'idle');
});

test('warm successive holds reuse the model and do not cancel it on success or idle close', async () => {
  const f = keylessFixture();
  await submit(f); f.controller.cancel(); await submit(f);
  assert.equal(f.captures(), 2); assert.equal(f.stopped(), 2);
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 2);
  assert.equal(f.localCalls.some(call => call[0].startsWith('cancel')), false);
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
  assert.ok(f.localCalls.some(call => call[0] === 'cancel-rabbit'));
  assert.equal(f.calls.length, 0); assert.equal(f.controller.state.phase, 'idle');
});

test('cancel during Rabbit analysis prevents later Spotify search and playback', async () => {
  const result = deferred();
  const f = keylessFixture({ recognizer: { async transcribeBlob() { return { transcript: '어제 얘기한 곡을 찾아 주세요', lang: 'ko' }; } }, rabbit: { request: () => result.promise } });
  await f.controller.begin(); f.controller.release(); await tick(); await tick();
  assert.equal(f.controller.state.phase, 'analyzing');
  f.controller.cancel(); result.resolve({ artist: '아이유', title: '밤편지' }); await tick();
  assert.equal(f.calls.length, 0); assert.equal(f.controller.state.phase, 'idle');
});

test('local model failure is actionable and never falls back to paid transcription', async () => {
  const f = keylessFixture({ recognizer: { async transcribeBlob() { throw Object.assign(new Error('runtime details'), { code: 'local_transcription_timeout' }); } } });
  await submit(f);
  assert.equal(f.controller.state.phase, 'error'); assert.match(f.controller.state.message, /시간이 초과/);
  assert.equal(f.calls.length, 0); assert.equal(f.localCalls.some(call => call[0] === 'text'), false);
});

test('unstructured commands send only recognized text to Rabbit as a fallback', async () => {
  const f = keylessFixture({ recognizer: { async transcribeBlob() { return { transcript: '어제 얘기한 곡을 찾아 주세요', lang: 'ko' }; } } });
  await submit(f);
  assert.deepEqual(f.localCalls.find(call => call[0] === 'text'), ['text', '어제 얘기한 곡을 찾아 주세요']);
  assert.equal(f.controller.state.phase, 'done');
  assert.equal(f.calls.some(call => call === 'token' || call[0]?.startsWith('/api/voice')), false);
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
