import test from 'node:test';
import assert from 'node:assert/strict';
import { RabbitProbe, SpeechProbe, MicrophoneProbe, PROBE_TEST_TEXT } from '../dist/rabbit-probe.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  let next = 0;
  const timers = new Map(), events = [], sent = [], recognizers = [], recorders = [];
  const host = { fetch() { throw Error('diagnostics must not upload'); } };
  const options = { host, onState: event => events.push(event), nonce: () => `request-${++next}`,
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimer: id => timers.delete(id) };
  function fire(ms) { const item = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(item, `timer ${ms}`); timers.delete(item[0]); item[1].fn(); }
  const bridge = () => { host.PluginMessageHandler = { postMessage: message => sent.push(JSON.parse(message)) }; };
  const response = (overrides = {}, index = sent.length - 1) => {
    const request = JSON.parse(sent[index].message.split('Request: ')[1]);
    return { requestId: request.requestId, artist: '아이유', title: '밤편지', language: 'ko', ...overrides };
  };
  class Recognition {
    constructor() { recognizers.push(this); this.lang = 'default'; }
    start() { this.started = true; this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    result(text, final = true) { this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: final })] }); }
  }
  let trackStops = 0, captures = 0;
  const stream = { getTracks: () => [{ stop() { trackStops++; } }] };
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm'; }
    constructor(stream, config) { this.mimeType = config.mimeType; this.state = 'inactive'; recorders.push(this); }
    start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
    stop() { this.state = 'inactive'; }
    chunk(size) { this.ondataavailable?.({ data: { size, arrayBuffer() { throw Error('audio must not be read'); } } }); }
  }
  const mic = (permission = Promise.resolve(stream)) => {
    host.MediaRecorder = Recorder;
    host.navigator = { mediaDevices: { getUserMedia: () => { captures++; return permission; } } };
  };
  return { host, options, timers, events, sent, bridge, response, fire, recognizers, recorders, stream, Recognition, mic,
    captures: () => captures, trackStops: () => trackStops };
}

test('capabilities update when native bridge and browser APIs are injected late', async () => {
  const f = fixture(), rabbit = new RabbitProbe(f.options), speech = new SpeechProbe(f.options), microphone = new MicrophoneProbe(f.options);
  assert.equal(rabbit.supported, false); assert.equal(speech.supported, false); assert.equal(microphone.supported, false);
  await assert.rejects(rabbit.request(PROBE_TEST_TEXT), { code: 'unsupported' });
  await assert.rejects(speech.begin(), { code: 'unsupported' });
  await assert.rejects(microphone.begin(), { code: 'unsupported' });
  f.bridge(); f.host.webkitSpeechRecognition = f.Recognition; f.mic();
  assert.equal(rabbit.supported, true); assert.equal(speech.supported, true); assert.equal(microphone.supported, true);
  rabbit.dispose();
});

test('Rabbit sends only documented text fields and validates correlated JSON envelope', async () => {
  const f = fixture(); f.bridge();
  const rabbit = new RabbitProbe(f.options), request = rabbit.request(PROBE_TEST_TEXT);
  assert.deepEqual(Object.keys(f.sent[0]).sort(), ['message', 'useLLM', 'wantsJournalEntry', 'wantsR1Response']);
  assert.equal(f.sent[0].useLLM, true); assert.equal(f.sent[0].wantsR1Response, false); assert.equal(f.sent[0].wantsJournalEntry, false);
  f.host.onPluginMessage({ data: JSON.stringify(f.response()) });
  assert.deepEqual(await request, f.response());
  assert.equal(rabbit.active, false); assert.equal(f.timers.size, 0); rabbit.dispose();
});

test('default timer wrappers do not call browser functions with a probe receiver', () => {
  const f = fixture(); f.bridge();
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  let scheduled = 0, cleared = 0, request;
  try {
    globalThis.setTimeout = function () { assert.ok(this === undefined || this === globalThis); scheduled++; return 42; };
    globalThis.clearTimeout = function () { assert.ok(this === undefined || this === globalThis); cleared++; };
    const rabbit = new RabbitProbe({ host: f.host, nonce: () => 'timer-test' });
    request = rabbit.request(PROBE_TEST_TEXT);
    f.host.onPluginMessage(f.response()); rabbit.dispose();
  } finally { globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear; }
  assert.equal(scheduled, 1); assert.equal(cleared, 1);
  return request.then(result => assert.equal(result.requestId, 'timer-test'));
});

test('Rabbit preserves an existing callback and restores only its own handler', async () => {
  const f = fixture(); f.bridge(); let forwarded = 0;
  const previous = f.host.onPluginMessage = () => { forwarded++; };
  const rabbit = new RabbitProbe(f.options), request = rabbit.request(PROBE_TEST_TEXT);
  f.host.onPluginMessage(JSON.stringify({ message: '```json\n' + JSON.stringify(f.response()) + '\n```' }));
  await request; assert.equal(forwarded, 1);
  rabbit.dispose(); assert.equal(f.host.onPluginMessage, previous);
  const other = new RabbitProbe(f.options), replacement = () => {};
  f.host.onPluginMessage = replacement; other.dispose(); assert.equal(f.host.onPluginMessage, replacement);
});

test('uncorrelated, oversized and malformed replies never count as extraction success', async () => {
  const f = fixture(); f.bridge(); const rabbit = new RabbitProbe(f.options), request = rabbit.request(PROBE_TEST_TEXT);
  const rejection = assert.rejects(request, { code: 'timeout' });
  f.host.onPluginMessage({ data: JSON.stringify(f.response({ requestId: 'other' })) });
  f.host.onPluginMessage('x'.repeat(17000)); f.host.onPluginMessage({ data: 'invalid' });
  assert.equal(rabbit.active, true); assert.equal(f.events.filter(event => event.code === 'uncorrelated').length, 3);
  assert.equal(f.events.some(event => event.state === 'success'), false);
  f.fire(20000); await rejection; assert.equal(f.timers.size, 0); rabbit.dispose();
});

test('Rabbit cancels immediately and rejects stale replies after a new request', async () => {
  const f = fixture(); f.bridge(); const rabbit = new RabbitProbe(f.options), first = rabbit.request(PROBE_TEST_TEXT);
  const rejected = assert.rejects(first, { code: 'cancelled' }); rabbit.cancel(); await rejected;
  const second = rabbit.request(PROBE_TEST_TEXT);
  f.host.onPluginMessage(f.response({}, 0)); assert.equal(rabbit.active, true);
  f.host.onPluginMessage(f.response({}, 1)); await second;
  assert.equal(f.events.filter(event => event.state === 'success').length, 1); rabbit.dispose();
});

test('Rabbit rejects missing fields, invalid input and synchronous native failures safely', async () => {
  const f = fixture(); f.bridge(); const rabbit = new RabbitProbe(f.options);
  await assert.rejects(rabbit.request(''), { code: 'invalid_text' });
  const request = rabbit.request(PROBE_TEST_TEXT); f.host.onPluginMessage(f.response({ title: '' }));
  await assert.rejects(request, { code: 'invalid_response' });
  f.host.PluginMessageHandler.postMessage = () => { throw Error('secret raw native message'); };
  await assert.rejects(rabbit.request(PROBE_TEST_TEXT), { code: 'bridge_failed' });
  assert.equal(JSON.stringify(f.events).includes('secret'), false); assert.equal(f.timers.size, 0); rabbit.dispose();
});

test('speech default leaves language unset, interim alone cannot be successful', async () => {
  const f = fixture(); f.host.SpeechRecognition = f.Recognition; const speech = new SpeechProbe(f.options), request = speech.begin();
  assert.equal(f.recognizers[0].lang, 'default');
  f.recognizers[0].result('unfinished words', false); assert.equal(f.events.at(-1).interim, 'unfinished words');
  speech.release(); f.recognizers[0].onend();
  await assert.rejects(request, { code: 'no_speech' }); assert.equal(f.recognizers[0].aborted, true); assert.equal(f.timers.size, 0);
});

test('speech waits for final result after release, then completes on end', async () => {
  const f = fixture(); f.host.SpeechRecognition = f.Recognition; const speech = new SpeechProbe(f.options), request = speech.begin({ lang: 'ko-KR' });
  const recognition = f.recognizers[0]; assert.equal(recognition.lang, 'ko-KR');
  speech.release(); assert.equal(recognition.stopped, true); assert.equal(speech.active, true);
  recognition.result(PROBE_TEST_TEXT); assert.equal(speech.active, true);
  recognition.onend(); assert.deepEqual(await request, { transcript: PROBE_TEST_TEXT, lang: 'ko-KR' });
  assert.equal(f.timers.size, 0);
});

test('speech released before permission/onstart cancels and ignores a delayed start', async () => {
  const f = fixture(); f.Recognition.prototype.start = function () {};
  f.host.SpeechRecognition = f.Recognition;
  const speech = new SpeechProbe(f.options), request = speech.begin();
  const delayedStart = f.recognizers[0].onstart;
  const rejected = assert.rejects(request, { code: 'cancelled' }); speech.release(); await rejected;
  assert.equal(f.recognizers[0].aborted, true); assert.equal(f.recognizers[0].onstart, null);
  delayedStart();
  assert.equal(f.events.some(event => event.state === 'listening'), false);
  assert.equal(speech.active, false); assert.equal(f.timers.size, 0);
});

test('speech handles spontaneous end, final timeout fallback and missing speech timeout', async () => {
  const f = fixture(); f.host.SpeechRecognition = f.Recognition; const speech = new SpeechProbe(f.options);
  const first = speech.begin(); f.recognizers[0].result('Play Yesterday'); f.recognizers[0].onend();
  assert.equal((await first).transcript, 'Play Yesterday');
  const second = speech.begin(); f.recognizers[1].result('Play Yesterday'); f.fire(15000); f.fire(8000);
  assert.equal((await second).transcript, 'Play Yesterday');
  const third = speech.begin(), rejected = assert.rejects(third, { code: 'timeout' });
  f.fire(15000); f.fire(8000); await rejected; assert.equal(f.timers.size, 0);
});

test('speech cancellation suppresses late result and handles safe native errors', async () => {
  const f = fixture(); f.host.SpeechRecognition = f.Recognition; const speech = new SpeechProbe(f.options), first = speech.begin();
  const lateResult = f.recognizers[0].onresult, lateEnd = f.recognizers[0].onend;
  const cancelled = assert.rejects(first, { code: 'cancelled' }); speech.cancel(); await cancelled;
  const second = speech.begin(), denied = assert.rejects(second, { code: 'permission' });
  lateResult({ results: [Object.assign([{ transcript: 'stale' }], { isFinal: true })] }); lateEnd();
  assert.equal(speech.active, true); f.recognizers[1].onerror({ error: 'not-allowed', message: 'private raw text' }); await denied;
  assert.equal(JSON.stringify(f.events).includes('private'), false); assert.equal(f.timers.size, 0);
});

test('microphone records metadata only; stops tracks and does not read or retain audio', async () => {
  const f = fixture(); f.mic(); const microphone = new MicrophoneProbe(f.options), request = microphone.begin();
  await tick(); const recorder = f.recorders[0]; assert.equal(recorder.timeslice, 250);
  recorder.chunk(120); microphone.release(); recorder.chunk(30); recorder.onstop();
  assert.deepEqual(await request, { bytes: 150, mimeType: 'audio/webm' });
  assert.equal(f.trackStops(), 1); assert.equal(f.timers.size, 0); assert.equal(microphone.active, false);
  assert.equal(JSON.stringify(f.events).includes('arrayBuffer'), false);
});

test('release during pending microphone permission settles and late stream is stopped', async () => {
  const f = fixture(), permission = deferred(); f.mic(permission.promise);
  const microphone = new MicrophoneProbe(f.options), request = microphone.begin(), rejected = assert.rejects(request, { code: 'cancelled' });
  await tick(); microphone.release(); await rejected;
  permission.resolve(f.stream); await tick(); assert.equal(f.trackStops(), 1); assert.equal(f.recorders.length, 0); assert.equal(f.timers.size, 0);
});

test('microphone pending permission timeout also cleans a late stream', async () => {
  const f = fixture(), permission = deferred(); f.mic(permission.promise);
  const microphone = new MicrophoneProbe(f.options), request = microphone.begin(), rejected = assert.rejects(request, { code: 'timeout' });
  await tick(); f.fire(20000); await rejected; permission.resolve(f.stream); await tick();
  assert.equal(f.trackStops(), 1); assert.equal(f.recorders.length, 0);
});

test('microphone byte limit aborts capture with no retained payload', async () => {
  const f = fixture(); f.mic(); const microphone = new MicrophoneProbe(f.options), request = microphone.begin();
  const rejected = assert.rejects(request, { code: 'too_large' }); await tick(); f.recorders[0].chunk(2 * 1024 * 1024 + 1); await rejected;
  assert.equal(f.trackStops(), 1); assert.equal(f.recorders[0].state, 'inactive'); assert.equal(f.timers.size, 0);
});

test('microphone auto-stops at 15 seconds and bounds missing onstop', async () => {
  const f = fixture(); f.mic(); const microphone = new MicrophoneProbe(f.options), request = microphone.begin();
  const rejected = assert.rejects(request, { code: 'timeout' }); await tick(); f.fire(15000);
  assert.equal(f.recorders[0].state, 'inactive'); assert.equal(f.trackStops(), 1); f.fire(3000); await rejected; assert.equal(f.timers.size, 0);
});

test('dispose prevents all probes from starting new work', async () => {
  const f = fixture(); f.bridge(); f.mic(); f.host.SpeechRecognition = f.Recognition;
  const rabbit = new RabbitProbe(f.options), speech = new SpeechProbe(f.options), microphone = new MicrophoneProbe(f.options);
  rabbit.dispose(); speech.dispose(); microphone.dispose();
  await assert.rejects(rabbit.request(PROBE_TEST_TEXT), { code: 'disposed' });
  await assert.rejects(speech.begin(), { code: 'disposed' }); await assert.rejects(microphone.begin(), { code: 'disposed' });
  assert.equal(f.captures(), 0); assert.equal(f.sent.length, 0); assert.equal(f.recognizers.length, 0);
});
