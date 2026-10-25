import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalSpeechProbe, resampleToMono16k } from '../dist/local-speech.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const decodedAudio = ({ rate = 48000, length = rate, channels = 1, value = 0.25 } = {}) => ({
  sampleRate: rate, length, numberOfChannels: channels,
  getChannelData: () => new Float32Array(length).fill(value),
});

function fixture() {
  const events = [], workers = [], recorders = [], contexts = [], contextOptions = [], timers = new Map();
  let sequence = 0, captures = 0, stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const f = { decoded: decodedAudio(), permission: Promise.resolve(stream) };
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.messages = []; workers.push(this); }
    postMessage(data, transfer) { this.messages.push({ data, transfer }); }
    terminate() { this.terminated = true; }
    reply(type, fields = {}, id = this.messages.at(-1).data.id) { this.onmessage?.({ data: { id, type, ...fields } }); }
  }
  class Context {
    constructor(options) {
      contextOptions.push(options);
      if (options?.sampleRate && f.rejectSampleRate) throw new Error('unsupported context rate');
      contexts.push(this);
    }
    decodeAudioData(data) { this.encoded = data; return f.decodePromise || Promise.resolve(f.decoded); }
    close() { this.closed = true; return Promise.resolve(); }
  }
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm'; }
    constructor(input, options) { this.input = input; this.mimeType = options.mimeType; this.state = 'inactive'; recorders.push(this); }
    start(slice) { this.state = 'recording'; this.slice = slice; }
    stop() { this.state = 'inactive'; this.stopRequested = true; }
    chunk(size = 100) { this.ondataavailable?.({ data: new Blob([new Uint8Array(size)], { type: this.mimeType }) }); }
    end() { this.onstop?.(); }
  }
  const host = { Worker, AudioContext: Context, MediaRecorder: Recorder, Blob,
    navigator: { mediaDevices: { getUserMedia() { captures++; return f.permission; } } },
    fetch() { throw Error('audio upload forbidden'); },
  };
  const options = { host, onState: event => events.push(event),
    setTimer(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimer(id) { timers.delete(id); },
  };
  const probe = new LocalSpeechProbe(options);
  Object.assign(f, { host, probe, events, workers, recorders, contexts, contextOptions, timers, stream,
    captures: () => captures, stopped: () => stopped,
    fire(ms) { const found = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(found, `timer ${ms} exists`); timers.delete(found[0]); found[1].fn(); },
    async ready() { const pending = probe.prepare(); workers.at(-1).reply('ready'); await pending; },
  });
  return f;
}

test('preparation downloads only through a module worker and never opens the microphone or audio context', async () => {
  const f = fixture();
  assert.equal(f.probe.supported, true);
  assert.equal(f.probe.ready, false);
  await assert.rejects(f.probe.begin(), { code: 'local_not_ready' });
  const pending = f.probe.prepare(), worker = f.workers[0];
  assert.equal(f.probe.active, true);
  assert.equal(worker.url.href.endsWith('/local-asr-worker.mjs?v=20261025-r26'), true);
  assert.deepEqual(worker.options, { type: 'module' });
  assert.equal(f.captures(), 0);
  assert.equal(f.contexts.length, 0);
  worker.reply('progress', { progress: { status: 'progress', loaded: 20, total: 100, progress: 20, file: 'private-path' } });
  assert.deepEqual(f.events.at(-1), { state: 'loading', progress: { status: 'progress', loaded: 20, total: 100, progress: 20 } });
  worker.reply('ready');
  assert.deepEqual(await pending, { ready: true });
  assert.equal(f.probe.ready, true);
  assert.equal(f.probe.active, false);
  assert.equal(f.timers.size, 0);
  await f.probe.prepare();
  assert.equal(f.workers.length, 1);
  f.probe.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(f.probe.ready, false);
});

test('capability detection handles unavailable browser APIs without capture', async () => {
  const f = fixture(); delete f.host.Worker;
  assert.equal(f.probe.supported, false);
  await assert.rejects(f.probe.prepare(), { code: 'unsupported' });
  assert.equal(f.captures(), 0);
});

test('load timeout terminates the worker and retry ignores the old worker and wrong request IDs', async () => {
  const f = fixture(), pending = f.probe.prepare(), rejected = assert.rejects(pending, { code: 'local_model_timeout' });
  const worker = f.workers[0], staleCallback = worker.onmessage, oldId = worker.messages[0].data.id;
  worker.reply('ready', {}, oldId + 100);
  assert.equal(f.probe.ready, false);
  f.fire(180000); await rejected;
  assert.equal(worker.terminated, true);
  const retry = f.probe.prepare(), fresh = f.workers[1];
  staleCallback({ data: { id: oldId, type: 'ready' } });
  fresh.reply('ready', {}, oldId);
  assert.equal(f.probe.ready, false);
  fresh.reply('ready'); await retry;
  assert.equal(f.probe.ready, true);
  f.probe.dispose();
});

test('model errors expose safe codes only, and cancelling load requires fresh preparation', async () => {
  const f = fixture(), first = f.probe.prepare();
  f.workers[0].reply('error', { code: 'secret-server-body', message: 'sensitive content' });
  await assert.rejects(first, { code: 'model_load_failed' });
  const second = f.probe.prepare(), rejected = assert.rejects(second, { code: 'cancelled' });
  f.probe.cancel(); await rejected;
  assert.equal(f.probe.ready, false);
  assert.equal(f.workers[1].terminated, true);
  assert.equal(JSON.stringify(f.events).includes('sensitive'), false);
  assert.equal(JSON.stringify(f.events).includes('secret-server-body'), false);
  assert.equal(f.timers.size, 0);
});

test('recording release decodes locally, averages stereo, resamples, and transfers bounded PCM to worker', async () => {
  const f = fixture(); await f.ready();
  const worker = f.workers[0], pending = f.probe.begin({ lang: 'ko-KR' });
  assert.equal(f.contexts.length, 1);
  assert.deepEqual(f.contextOptions, [{ sampleRate: 16000 }]);
  await tick();
  const recorder = f.recorders[0];
  assert.equal(recorder.slice, 250);
  assert.equal(f.events.at(-1).state, 'recording');
  f.decoded = decodedAudio({ channels: 2 });
  recorder.chunk(20262); f.probe.release();
  assert.equal(recorder.stopRequested, true);
  assert.equal(f.stopped(), 1);
  assert.equal(f.contexts[0].closed, undefined);
  recorder.end(); await tick();
  const { data, transfer } = worker.messages.at(-1);
  assert.equal(data.type, 'transcribe');
  assert.equal(data.language, 'ko');
  assert.equal(data.audio.length, 16000);
  assert.equal(data.audio[1], 0.25);
  assert.equal(transfer[0], data.audio.buffer);
  assert.equal(f.contexts[0].closed, true);
  worker.reply('result', { text: '  아이유의\n밤편지 틀어줘 ', language: 'ko' });
  assert.deepEqual(await pending, { transcript: '아이유의 밤편지 틀어줘', lang: 'ko' });
  assert.equal(f.probe.ready, true);
  assert.equal(f.probe.active, false);
  assert.equal(f.timers.size, 0);
  f.probe.dispose();
});

test('release while permission is pending cancels, closes context, and stops a late permission stream', async () => {
  const f = fixture(); await f.ready();
  const permission = deferred(); f.permission = permission.promise;
  const pending = f.probe.begin(), rejected = assert.rejects(pending, { code: 'cancelled' });
  f.probe.release(); await rejected;
  assert.equal(f.contexts[0].closed, true);
  assert.equal(f.probe.ready, true);
  permission.resolve(f.stream); await tick();
  assert.equal(f.stopped(), 1);
  assert.equal(f.recorders.length, 0);
  assert.equal(f.timers.size, 0);
  f.probe.dispose();
});

test('microphone permission timeout and denial do not discard an already loaded model', async () => {
  const f = fixture(); await f.ready();
  const permission = deferred(); f.permission = permission.promise;
  const pending = f.probe.begin(), rejected = assert.rejects(pending, { code: 'microphone_timeout' });
  f.fire(20000); await rejected;
  permission.resolve(f.stream); await tick();
  assert.equal(f.stopped(), 1);
  f.permission = Promise.reject(Object.assign(new Error('private browser text'), { name: 'NotAllowedError' }));
  await assert.rejects(f.probe.begin(), { code: 'permission' });
  assert.equal(f.probe.ready, true);
  assert.ok(f.contexts.every(context => context.closed));
  assert.equal(f.timers.size, 0);
  f.probe.dispose();
});

test('stuck-button safety limit stops at 60 seconds and stop watchdog releases resources', async () => {
  const f = fixture(); await f.ready();
  const pending = f.probe.begin(), rejected = assert.rejects(pending, { code: 'stop_timeout' });
  await tick();
  f.recorders[0].chunk();
  f.fire(60000);
  assert.equal(f.recorders[0].stopRequested, true);
  f.fire(5000); await rejected;
  assert.equal(f.stopped(), 1);
  assert.equal(f.contexts[0].closed, true);
  assert.equal(f.probe.ready, true);
  f.probe.dispose();
});

test('oversized capture is discarded without invoking inference', async () => {
  const f = fixture(); await f.ready();
  const pending = f.probe.begin(), rejected = assert.rejects(pending, { code: 'audio_too_large' });
  await tick(); f.recorders[0].chunk(2 * 1024 * 1024 + 1); await rejected;
  assert.equal(f.workers[0].messages.length, 1);
  assert.equal(f.stopped(), 1);
  assert.equal(f.contexts[0].closed, true);
  assert.equal(f.timers.size, 0);
  f.probe.dispose();
});

test('transcribeBlob handles existing recorder audio without requesting microphone and returns detected language', async () => {
  const f = fixture(); await f.ready();
  const pending = f.probe.transcribeBlob(new Blob(['encoded']), { lang: '' });
  await tick();
  assert.equal(f.captures(), 0);
  assert.deepEqual(f.contextOptions, [{ sampleRate: 16000 }]);
  assert.equal(f.workers[0].messages.at(-1).data.language, '');
  f.workers[0].reply('result', { text: '夜に駆けるを再生', language: 'ja' });
  assert.deepEqual(await pending, { transcript: '夜に駆けるを再生', lang: 'ja' });
  f.probe.dispose();
});

test('unsupported native 16 kHz context falls back and filters decoded high-rate audio locally', async () => {
  const f = fixture(); await f.ready();
  f.rejectSampleRate = true;
  const rate = 48000, samples = Float32Array.from({ length: rate }, (_, i) => Math.sin(2 * Math.PI * 10000 * i / rate));
  f.decoded = { sampleRate: rate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
  const pending = f.probe.transcribeBlob(new Blob(['encoded'])); await tick();
  assert.deepEqual(f.contextOptions, [{ sampleRate: 16000 }, undefined]);
  const audio = f.workers[0].messages.at(-1).data.audio;
  assert.equal(audio.length, 16000);
  assert.ok(audio.slice(100, -100).every(value => Math.abs(value) < 0.01));
  assert.equal(f.contexts[0].closed, true);
  f.workers[0].reply('result', { text: 'filtered speech', language: 'en' }); await pending;
  f.probe.dispose();
});

test('busy requests and unsupported language never open another microphone or context', async () => {
  const f = fixture(); await f.ready();
  await assert.rejects(f.probe.begin({ lang: 'not-a-language' }), { code: 'language_unsupported' });
  assert.equal(f.captures(), 0);
  const pending = f.probe.transcribeBlob(new Blob(['encoded'])), rejected = assert.rejects(pending, { code: 'cancelled' });
  await assert.rejects(f.probe.begin(), { code: 'busy' });
  await assert.rejects(f.probe.prepare(), { code: 'busy' });
  await assert.rejects(f.probe.transcribeBlob(new Blob(['other'])), { code: 'busy' });
  assert.equal(f.contexts.length, 1);
  f.probe.cancel(); await rejected;
  f.probe.dispose();
  await assert.rejects(f.probe.prepare(), { code: 'disposed' });
});

test('cancellation while decoding ignores late decode and terminates the inference worker', async () => {
  const f = fixture(); await f.ready();
  const decode = deferred(); f.decodePromise = decode.promise;
  const pending = f.probe.transcribeBlob(new Blob(['encoded'])), rejected = assert.rejects(pending, { code: 'cancelled' });
  await tick(); f.probe.cancel(); await rejected;
  decode.resolve(f.decoded); await tick();
  assert.equal(f.workers[0].messages.length, 1);
  assert.equal(f.workers[0].terminated, true);
  assert.equal(f.contexts[0].closed, true);
  assert.equal(f.probe.ready, false);
  assert.equal(f.timers.size, 0);
});

test('transcription timeout and cancellation ignore late worker results and discard readiness', async () => {
  const f = fixture(); await f.ready();
  const first = f.probe.transcribeBlob(new Blob(['encoded'])), rejected = assert.rejects(first, { code: 'local_transcription_timeout' });
  await tick();
  const worker = f.workers[0], lateMessage = worker.onmessage, id = worker.messages.at(-1).data.id;
  f.fire(120000); await rejected;
  assert.equal(f.probe.ready, false);
  await f.ready();
  const second = f.probe.transcribeBlob(new Blob(['encoded'])), cancelled = assert.rejects(second, { code: 'cancelled' });
  await tick();
  lateMessage({ data: { id, type: 'result', text: 'stale transcription', language: 'en' } });
  assert.equal(f.probe.active, true);
  f.probe.cancel(); await cancelled;
  assert.equal(f.events.some(event => event.state === 'success'), false);
  assert.equal(f.workers[1].terminated, true);
  assert.equal(f.timers.size, 0);
});

test('blob size, decoded duration/channel bounds, and decoder errors are validated before inference', async () => {
  const f = fixture(); await f.ready();
  await assert.rejects(f.probe.transcribeBlob(new Blob([])), { code: 'empty_audio' });
  await assert.rejects(f.probe.transcribeBlob(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)])), { code: 'audio_too_large' });
  await assert.rejects(f.probe.transcribeBlob({ size: 2 }), { code: 'invalid_audio' });
  f.decoded = decodedAudio({ length: 48000 * 62 });
  await assert.rejects(f.probe.transcribeBlob(new Blob(['encoded'])), { code: 'audio_too_long' });
  f.decoded = decodedAudio({ channels: 8 });
  await assert.rejects(f.probe.transcribeBlob(new Blob(['encoded'])), { code: 'invalid_audio' });
  f.decodePromise = Promise.reject(new Error('private decoder details'));
  await assert.rejects(f.probe.transcribeBlob(new Blob(['encoded'])), { code: 'decode_failed' });
  assert.equal(f.workers[0].messages.length, 1);
  assert.ok(f.contexts.every(context => context.closed));
  assert.equal(JSON.stringify(f.events).includes('private decoder'), false);
  f.probe.dispose();
});

test('empty or malformed worker results do not claim speech success', async () => {
  const f = fixture(); await f.ready();
  const first = f.probe.transcribeBlob(new Blob(['encoded'])); await tick();
  f.workers[0].reply('result', { text: ' ', language: 'en' });
  await assert.rejects(first, { code: 'no_speech' });
  const second = f.probe.transcribeBlob(new Blob(['encoded'])); await tick();
  f.workers[0].reply('result', { text: 'some text', language: '<script>' });
  await assert.rejects(second, { code: 'invalid_response' });
  assert.equal(f.probe.ready, true);
  assert.equal(f.timers.size, 0);
  f.probe.dispose();
});

test('a worker crash invalidates loaded state even while idle', async () => {
  const f = fixture(); await f.ready();
  let prevented = false;
  f.workers[0].onerror({ preventDefault() { prevented = true; }, message: 'secret stack trace' });
  assert.equal(prevented, true);
  assert.equal(f.probe.ready, false);
  assert.equal(f.workers[0].terminated, true);
  assert.deepEqual(f.events.at(-1), { state: 'error', code: 'local_worker_failed' });
});

test('resampling averages channels, linearly interpolates, clamps PCM, and caps sample count', () => {
  const channels = [new Float32Array(8000).fill(0.25), new Float32Array(8000).fill(0.75)];
  channels[0][1] = 0.75;
  const stereo = { sampleRate: 8000, length: 8000, numberOfChannels: 2, getChannelData: i => channels[i] };
  const result = resampleToMono16k(stereo);
  assert.equal(result.length, 16000);
  assert.equal(result[0], 0.5);
  assert.equal(result[1], 0.625);
  assert.equal(result[2], 0.75);
  assert.equal(resampleToMono16k(decodedAudio({ value: 1.000001 }))[0], 1);
  assert.equal(resampleToMono16k(decodedAudio({ value: -2 }))[0], -1);
  assert.equal(resampleToMono16k(decodedAudio({ rate: 16000, length: 16000 * 61 })).length, 960000);
  assert.throws(() => resampleToMono16k(decodedAudio({ value: NaN })), { code: 'invalid_audio' });
  assert.throws(() => resampleToMono16k(decodedAudio({ length: 48 })), { code: 'empty_audio' });
  assert.throws(() => resampleToMono16k(decodedAudio({ rate: 1000 })), { code: 'invalid_audio' });
});

test('downsampling preserves speech-band audio and rejects aliasing at 44.1, 48 and 192 kHz', () => {
  const rms = audio => Math.sqrt(audio.slice(100, -100).reduce((sum, value) => sum + value * value, 0) / (audio.length - 200));
  for (const rate of [44100, 48000, 192000]) {
    const tone = frequency => {
      const samples = Float32Array.from({ length: rate / 10 }, (_, i) => Math.sin(2 * Math.PI * frequency * i / rate));
      return resampleToMono16k({ sampleRate: rate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples });
    };
    assert.ok(rms(tone(1000)) > 0.69, `1 kHz speech band preserved at ${rate}`);
    assert.ok(rms(tone(10000)) < 0.01, `10 kHz alias rejected at ${rate}`);
  }
});

 test('cold transcription joins one background preparation without delaying microphone capture elsewhere', async () => {
  const f = fixture(), loading = f.probe.prepare(), joined = f.probe.prepare();
  const pending = f.probe.transcribeBlob(new Blob(['recorded while loading']));
  assert.equal(f.workers.length, 1);
  assert.equal(f.contexts.length, 0);
  assert.equal(f.captures(), 0);
  f.workers[0].reply('ready'); await Promise.all([loading, joined]); await tick();
  assert.equal(f.workers[0].messages.at(-1).data.type, 'transcribe');
  f.workers[0].reply('result', { text: 'play a song', language: 'en' });
  assert.equal((await pending).transcript, 'play a song');
  f.probe.dispose();
});

 test('cancel at preparation completion cannot start a stale transcription', async () => {
  const f = fixture();
  const pending = f.probe.transcribeBlob(new Blob(['cancelled recording']));
  const rejected = assert.rejects(pending, { code: 'cancelled' });
  f.workers[0].reply('ready'); f.probe.cancel(); await rejected;
  assert.equal(f.contexts.length, 0);
  assert.equal(f.workers[0].messages.length, 1);
  assert.equal(f.probe.ready, true);
  f.probe.dispose();
});

 test('twenty-second speech is preserved beyond the former fifteen-second cutoff', async () => {
  const f = fixture(); await f.ready();
  f.decoded = decodedAudio({ rate: 16000, length: 16000 * 20 });
  const pending = f.probe.transcribeBlob(new Blob(['long recording'])); await tick();
  assert.equal(f.workers[0].messages.at(-1).data.audio.length, 320000);
  f.workers[0].reply('result', { text: 'long song request', language: 'en' }); await pending;
  f.probe.dispose();
});
