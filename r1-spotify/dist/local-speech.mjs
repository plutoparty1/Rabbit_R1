// Audio stays in this page and its dedicated inference worker. Only model files
// are downloaded by the worker; recordings are never uploaded or persisted.
const MAX_BYTES = 2 * 1024 * 1024;
const SAMPLE_RATE = 16000;
const MAX_SAMPLES = 15 * SAMPLE_RATE;
const languages = new Map([['', ''], ['ko-KR', 'ko'], ['en-US', 'en'], ['ja-JP', 'ja']]);
const workerErrors = new Set(['model_load_failed', 'transcription_failed', 'invalid_audio', 'busy']);
const failure = code => Object.assign(new Error(code), { code });
const stopTracks = stream => { try { stream?.getTracks().forEach(track => { try { track.stop(); } catch {} }); } catch {} };
const mediaError = reason => ['NotAllowedError', 'SecurityError'].includes(reason?.name) ? 'permission' : reason?.name === 'NotFoundError' ? 'no_microphone' : 'capture_failed';
const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

// MediaRecorder's final chunk can straddle the 15-second stop deadline. Allow
// at most one extra second for decoding, then cap inference at exactly 15s.
export function resampleToMono16k(buffer) {
  const rate = buffer?.sampleRate, length = buffer?.length, channels = buffer?.numberOfChannels;
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000 || !Number.isSafeInteger(length) || length < 1 || ![1, 2].includes(channels)) throw failure('invalid_audio');
  if (length / rate > 16) throw failure('audio_too_long');
  const count = Math.min(MAX_SAMPLES, Math.floor(length * SAMPLE_RATE / rate));
  if (count < 160) throw failure('empty_audio');
  let inputs;
  try { inputs = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel)); }
  catch { throw failure('invalid_audio'); }
  if (inputs.some(input => !input || input.length !== length)) throw failure('invalid_audio');
  const output = new Float32Array(count), ratio = rate / SAMPLE_RATE;
  // Usually decodeAudioData already returns native-filtered 16 kHz audio. Older
  // WebViews may reject that AudioContext rate; low-pass their higher-rate output
  // before decimation so microphone noise above 8 kHz cannot alias into speech.
  const radius = ratio > 1 ? Math.ceil(12 * ratio) : 0;
  const cutoff = 0.45 / ratio, kernels = new Map();
  function kernel(phase) {
    const key = Math.round(phase * 1024);
    if (!kernels.has(key)) {
      const fraction = key / 1024, weights = new Float64Array(radius * 2 + 1);
      for (let delta = -radius; delta <= radius; delta++) {
        const distance = delta - fraction;
        if (Math.abs(distance) > radius) continue;
        const sinc = Math.abs(distance) < 1e-12 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
        weights[delta + radius] = sinc * (0.5 + 0.5 * Math.cos(Math.PI * distance / radius));
      }
      kernels.set(key, weights);
    }
    return kernels.get(key);
  }
  for (let i = 0; i < count; i++) {
    const offset = i * ratio, left = Math.floor(offset), right = Math.min(left + 1, length - 1), mix = offset - left;
    let sample = 0;
    if (radius) {
      const weights = kernel(mix);
      let total = 0;
      for (let delta = Math.max(-radius, -left); delta <= Math.min(radius, length - left - 1); delta++) {
        const weight = weights[delta + radius];
        for (const input of inputs) sample += input[left + delta] * weight;
        total += weight;
      }
      sample /= total;
    } else {
      for (const input of inputs) sample += input[left] * (1 - mix) + input[right] * mix;
    }
    sample /= channels;
    if (!Number.isFinite(sample)) throw failure('invalid_audio');
    output[i] = Math.max(-1, Math.min(1, sample));
  }
  return output;
}

export class LocalSpeechProbe {
  constructor({ host = globalThis, onState = () => {}, setTimer = (...args) => setTimeout(...args), clearTimer = timer => clearTimeout(timer) } = {}) {
    Object.assign(this, { host, onState, setTimer, clearTimer });
    this.session = null;
    this.worker = null;
    this.sequence = 0;
    this.modelReady = false;
    this.disposed = false;
  }
  get AudioContext() { return this.host.AudioContext || this.host.webkitAudioContext; }
  get supported() { return typeof this.host.Worker === 'function' && typeof this.AudioContext === 'function' && typeof this.host.MediaRecorder === 'function' && typeof this.host.navigator?.mediaDevices?.getUserMedia === 'function'; }
  get active() { return this.session !== null; }
  get ready() { return this.modelReady && !!this.worker && !this.disposed; }
  createContext() {
    // decodeAudioData resamples to this rate using the browser's audio filter.
    try { return new this.AudioContext({ sampleRate: SAMPLE_RATE }); }
    catch { return new this.AudioContext(); }
  }
  emit(event) { try { this.onState(event); } catch {} }
  current(session) { return this.session === session; }
  create(phase) {
    if (this.disposed) throw failure('disposed');
    if (this.active) throw failure('busy');
    const session = { id: ++this.sequence, phase, timers: new Set(), chunks: [] };
    session.promise = new Promise((resolve, reject) => Object.assign(session, { resolve, reject }));
    this.session = session;
    return session;
  }
  timer(session, fn, ms) {
    const id = this.setTimer(() => { session.timers.delete(id); if (this.current(session)) fn(); }, ms);
    session.timers.add(id);
    return id;
  }
  clear(session, id) { if (id !== undefined) { this.clearTimer(id); session.timers.delete(id); } }
  closeContext(session) {
    const context = session.context;
    session.context = null;
    try { context?.close()?.catch?.(() => {}); } catch {}
  }
  cleanup(session) {
    for (const id of session.timers) this.clearTimer(id);
    session.timers.clear();
    if (session.recorder) {
      for (const name of ['ondataavailable', 'onerror', 'onstop', 'onstart']) session.recorder[name] = null;
      try { if (session.recorder.state !== 'inactive') session.recorder.stop(); } catch {}
    }
    stopTracks(session.stream);
    session.stream = null;
    session.chunks.length = 0;
    this.closeContext(session);
  }
  terminateWorker() {
    const worker = this.worker;
    this.worker = null;
    this.modelReady = false;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      try { worker.terminate(); } catch {}
    }
  }
  finish(session, result, code, terminate = false) {
    if (!this.current(session)) return;
    this.session = null;
    this.cleanup(session);
    if (terminate) this.terminateWorker();
    this.emit(code ? { state: code === 'cancelled' ? 'cancelled' : 'error', code } : session.phase === 'loading' ? { state: 'ready' } : { state: 'success', result });
    if (code) session.reject(failure(code)); else session.resolve(result);
  }
  async prepare() {
    if (this.disposed) throw failure('disposed');
    if (this.active) throw failure('busy');
    if (this.ready) return { ready: true };
    if (!this.supported) throw failure('unsupported');
    const session = this.create('loading');
    this.emit({ state: 'loading' });
    if (!this.current(session)) return session.promise;
    this.timer(session, () => this.finish(session, null, 'local_model_timeout', true), 180000);
    try {
      this.terminateWorker();
      const worker = this.worker = new this.host.Worker(new URL('./local-asr-worker.mjs?v=20261025-r25', import.meta.url), { type: 'module' });
      worker.onmessage = event => { if (this.worker === worker) this.receive(event?.data); };
      worker.onerror = worker.onmessageerror = event => {
        try { event?.preventDefault?.(); } catch {}
        if (this.worker !== worker) return;
        if (this.session) this.finish(this.session, null, 'local_worker_failed', true);
        else { this.terminateWorker(); this.emit({ state: 'error', code: 'local_worker_failed' }); }
      };
      worker.postMessage({ id: session.id, type: 'load' });
    } catch { this.finish(session, null, 'local_worker_failed', true); }
    return session.promise;
  }
  receive(message) {
    const session = this.session;
    if (!session || !message || message.id !== session.id) return;
    if (message.type === 'error') {
      this.finish(session, null, workerErrors.has(message.code) ? message.code : session.phase === 'loading' ? 'model_load_failed' : 'transcription_failed', true);
      return;
    }
    if (session.phase === 'loading') {
      if (message.type === 'ready') {
        this.modelReady = true;
        this.finish(session, { ready: true });
      } else if (message.type === 'progress') {
        const progress = {}, source = message.progress || {};
        if (typeof source.status === 'string' && /^[a-z-]{1,30}$/i.test(source.status)) progress.status = source.status;
        for (const key of ['loaded', 'total', 'progress']) if (Number.isFinite(source[key]) && source[key] >= 0) progress[key] = source[key];
        this.emit({ state: 'loading', progress });
      }
      return;
    }
    if (session.phase !== 'transcribing' || message.type !== 'result') return;
    const transcript = typeof message.text === 'string' ? message.text.replace(/\s+/g, ' ').trim() : '';
    if (!transcript) { this.finish(session, null, 'no_speech'); return; }
    if (transcript.length > 500 || /[\u0000-\u001f\u007f]/.test(transcript) || typeof message.language !== 'string' || !/^(?:[a-z]{2,3}|unknown|auto)$/.test(message.language)) {
      this.finish(session, null, 'invalid_response'); return;
    }
    this.finish(session, { transcript, lang: message.language });
  }
  validateLanguage(lang) { if (!languages.has(lang)) throw failure('language_unsupported'); return languages.get(lang); }
  checkReady() {
    if (this.disposed) throw failure('disposed');
    if (this.active) throw failure('busy');
    if (!this.ready) throw failure('local_not_ready');
  }
  async begin({ lang = '' } = {}) {
    this.checkReady();
    const language = this.validateLanguage(lang);
    if (!this.supported) throw failure('unsupported');
    const session = this.create('waiting');
    session.language = language;
    session.bytes = 0;
    this.emit({ state: 'waiting' });
    if (!this.current(session)) return session.promise;
    session.permissionTimer = this.timer(session, () => this.finish(session, null, 'microphone_timeout'), 20000);
    try {
      // Construct during the user's press gesture, before microphone permission.
      session.context = this.createContext();
      Promise.resolve(this.host.navigator.mediaDevices.getUserMedia({ audio: true })).then(stream => {
        if (!this.current(session)) { stopTracks(stream); return; }
        this.clear(session, session.permissionTimer);
        session.stream = stream;
        try {
          const Recorder = this.host.MediaRecorder;
          const mimeType = mimes.find(type => { try { return Recorder.isTypeSupported?.(type); } catch { return false; } });
          const recorder = session.recorder = new Recorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
          recorder.ondataavailable = event => {
            if (!this.current(session) || !['recording', 'stopping'].includes(session.phase)) return;
            const data = event?.data;
            if (!data || !Number.isFinite(data.size) || data.size < 0) { this.finish(session, null, 'capture_failed'); return; }
            session.bytes += data.size;
            if (session.bytes > MAX_BYTES) { this.finish(session, null, 'audio_too_large'); return; }
            if (data.size) session.chunks.push(data);
          };
          recorder.onerror = () => this.finish(session, null, 'capture_failed');
          recorder.onstop = () => this.recordingStopped(session);
          session.phase = 'recording';
          recorder.start(250);
          if (!this.current(session)) return;
          session.durationTimer = this.timer(session, () => this.release(), 15000);
          this.emit({ state: 'recording' });
        } catch { this.finish(session, null, 'capture_failed'); }
      }, reason => this.finish(session, null, mediaError(reason)));
    } catch (reason) { this.finish(session, null, mediaError(reason)); }
    return session.promise;
  }
  release() {
    const session = this.session;
    if (!session) return;
    if (session.phase === 'waiting') { this.cancel(); return; }
    if (session.phase !== 'recording') return;
    session.phase = 'stopping';
    this.clear(session, session.durationTimer);
    session.stopTimer = this.timer(session, () => this.finish(session, null, 'stop_timeout'), 5000);
    try { if (session.recorder.state !== 'inactive') session.recorder.stop(); }
    catch { this.finish(session, null, 'capture_failed'); }
    stopTracks(session.stream);
    session.stream = null;
  }
  recordingStopped(session) {
    if (!this.current(session) || !['recording', 'stopping'].includes(session.phase)) return;
    this.clear(session, session.durationTimer);
    this.clear(session, session.stopTimer);
    stopTracks(session.stream);
    session.stream = null;
    let blob;
    try { blob = new (this.host.Blob || globalThis.Blob)(session.chunks, { type: session.recorder.mimeType || '' }); }
    catch { this.finish(session, null, 'capture_failed'); return; }
    session.chunks.length = 0;
    this.processBlob(session, blob);
  }
  async transcribeBlob(blob, { lang = '' } = {}) {
    this.checkReady();
    const language = this.validateLanguage(lang);
    const session = this.create('transcribing');
    session.language = language;
    try { session.context = this.createContext(); }
    catch { this.finish(session, null, 'decode_failed'); return session.promise; }
    this.processBlob(session, blob);
    return session.promise;
  }
  async processBlob(session, blob) {
    if (!this.current(session)) return;
    session.phase = 'transcribing';
    this.emit({ state: 'transcribing' });
    if (!this.current(session)) return;
    this.timer(session, () => this.finish(session, null, 'local_transcription_timeout', true), 120000);
    if (!blob || !Number.isFinite(blob.size) || blob.size < 0 || typeof blob.arrayBuffer !== 'function') { this.finish(session, null, 'invalid_audio'); return; }
    if (!blob.size) { this.finish(session, null, 'empty_audio'); return; }
    if (blob.size > MAX_BYTES) { this.finish(session, null, 'audio_too_large'); return; }
    try {
      const encoded = await blob.arrayBuffer();
      if (!this.current(session)) return;
      if (!(encoded instanceof ArrayBuffer) || encoded.byteLength < 1 || encoded.byteLength > MAX_BYTES) throw failure('invalid_audio');
      const context = session.context;
      const decoded = await new Promise((resolve, reject) => {
        const pending = context.decodeAudioData(encoded, resolve, reject);
        pending?.then?.(resolve, reject);
      });
      if (!this.current(session)) return;
      const audio = resampleToMono16k(decoded);
      this.closeContext(session);
      if (!this.worker || !this.modelReady) throw failure('local_not_ready');
      try { this.worker.postMessage({ id: session.id, type: 'transcribe', audio, language: session.language }, [audio.buffer]); }
      catch { this.finish(session, null, 'local_worker_failed', true); }
    } catch (reason) {
      const code = ['invalid_audio', 'audio_too_long', 'empty_audio', 'local_not_ready'].includes(reason?.code) ? reason.code : 'decode_failed';
      this.finish(session, null, code);
    }
  }
  cancel() {
    const session = this.session;
    if (session) this.finish(session, null, 'cancelled', ['loading', 'transcribing'].includes(session.phase));
  }
  dispose() { this.cancel(); this.disposed = true; this.terminateWorker(); }
}
