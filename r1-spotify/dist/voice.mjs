import { parseSongRequest, createSongSearchRequest } from './song-request.mjs?v=20261025-r29';

// Each hold owns its recorder/results; the microphone stays muted between holds.
// Safety stop for a missing button-release event, not a normal speaking deadline.
export const MAX_RECORDING_MS = 60000;
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const RECORDER_START_TIMEOUT_MS = 8000;
const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
const serverMessages = {
  unavailable: '음성 검색이 설정되지 않았습니다. 운영자가 Gemini API 키와 Spotify 사용자 허용 목록을 설정해야 합니다.',
  auth: 'Spotify에 다시 로그인해 주세요.',
  forbidden: '이 Spotify 계정은 음성 검색을 사용할 수 없습니다. 운영자에게 사용자 허용 목록을 확인해 주세요.',
  input: '녹음 요청이 올바르지 않습니다. 다시 녹음해 주세요.',
  too_large: '녹음 크기가 너무 큽니다. 더 짧게 말해 주세요.',
  unsupported_audio: '이 녹음 형식은 지원되지 않습니다. 다른 브라우저에서 시도해 주세요.',
  rate: '음성 요청이 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.',
  unrecognized: '곡명을 알아듣지 못했습니다. 가수와 곡명을 다시 말해 주세요.',
  provider: '음성 인식 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  timeout: '음성 요청 시간이 초과되었습니다. 다시 시도해 주세요.',
  cancelled: '음성 요청이 취소되었습니다.',
};
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{Z}\s]/gu, '');

// Keep public errors actionable without exposing model/runtime diagnostics.
export function keylessVoiceMessage(error) {
  const code = error?.code || error?.message;
  if (['model_load_failed', 'local_model_timeout', 'local_worker_failed'].includes(code)) return '음성 모델을 준비하지 못했습니다. Wi-Fi를 확인하고 다시 시도해 주세요.';
  if (code === 'local_not_ready') return '음성 기능을 준비하고 있습니다. 녹음 후 자동으로 처리합니다.';
  if (code === 'local_transcription_timeout') return '이 기기의 음성 처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
  if (['decode_failed', 'invalid_audio', 'empty_audio', 'transcription_failed', 'no_speech', 'invalid_response', 'invalid_text'].includes(code)) return '녹음에서 말을 인식하지 못했습니다. 가수와 곡명을 다시 말해 주세요.';
  if (['audio_too_large', 'audio_too_long'].includes(code)) return '녹음이 너무 깁니다. 가수와 곡명만 짧게 말해 주세요.';
  if (code === 'unsupported') return '이 기기에서 음성 모델을 실행할 수 없습니다. 래빗 Creation에서 다시 열어 주세요.';
  if (code === 'cancelled') return '음성 요청이 취소되었습니다.';
  return '기기 내 음성 인식을 완료하지 못했습니다. 다시 시도해 주세요.';
}

// Audio and command interpretation stay local. Only the search terms go to Spotify.
export function createKeylessTranscriber(recognizer) {
  const cancelled = () => Object.assign(new Error('cancelled'), { code: 'cancelled' });
  const cancel = () => recognizer.cancel();
  return {
    get ready() { return recognizer.ready; },
    get supported() { return recognizer.supported; },
    get unavailableMessage() { return keylessVoiceMessage({ code: 'unsupported' }); },
    prepare() { return recognizer.prepare(); },
    cancel,
    async recognize(blob, { signal, onTranscript = () => {} } = {}) {
      if (signal?.aborted) throw cancelled();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const speech = await recognizer.transcribeBlob(blob, { lang: '' });
        if (signal?.aborted) throw cancelled();
        onTranscript(speech.transcript, speech.lang);
        if (signal?.aborted) throw cancelled();
        // An unfamiliar sentence becomes a conservative catalog search instead
        // of waiting on Rabbit AI or failing when that text bridge is unavailable.
        const song = parseSongRequest(speech.transcript) || createSongSearchRequest(speech.transcript);
        if (!song) throw Object.assign(new Error('invalid_text'), { code: 'invalid_text' });
        if (signal?.aborted) throw cancelled();
        return { transcript: speech.transcript, language: speech.lang, artist: song.artist, title: song.title,
          ...(typeof song.query === 'string' ? { query: song.query } : {}), requiresConfirmation: Boolean(song.requiresConfirmation) };
      } finally { signal?.removeEventListener('abort', cancel); }
    },
  };
}

// Keep version words (live/remix/remastered) and symbols: a near match needs a tap.
export function exactVoiceTrack(tracks, request) {
  const title = normalize(request.title), artist = normalize(request.artist);
  if (!title || !artist) return null;
  const matches = tracks.filter(track => normalize(track.name) === title && track.artists?.some(item => normalize(item.name) === artist));
  return matches.length === 1 ? matches[0] : null;
}

export class VoiceController {
  constructor({ client, onChange = () => {}, canStart = () => true, deviceId = () => undefined,
    mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
    fetcher = (...args) => globalThis.fetch(...args), setTimer = (...args) => setTimeout(...args), clearTimer = timer => clearTimeout(timer),
    maxDuration = MAX_RECORDING_MS, maxBytes = MAX_AUDIO_BYTES, transcriber = null } = {}) {
    Object.assign(this, { client, onChange, canStart, deviceId, mediaDevices, Recorder, fetcher, setTimer, clearTimer, maxDuration, maxBytes, transcriber });
    this.session = null;
    this.microphoneStream = null;
    this.microphoneEpoch = 0;
    this.state = { phase: 'idle', message: '우측 버튼을 누르고 기다리세요.', transcript: '', language: '', tracks: [] };
  }
  get active() { return Boolean(this.session); }
  get microphoneReady() { return this.usableMicrophone(this.microphoneStream); }
  update(patch) { this.state = { ...this.state, ...patch }; this.onChange(this.state); }
  current(session) { return this.session === session && !session.abort.signal.aborted; }
  usableMicrophone(stream) {
    const tracks = stream?.getAudioTracks?.() || stream?.getTracks?.().filter(track => track.kind !== 'video') || [];
    return Boolean(stream && stream.active !== false && tracks.length && tracks.every(track => track.readyState === 'live'));
  }
  muteMicrophone(stream) { stream?.getTracks().forEach(track => { track.enabled = false; }); }
  discardMicrophone(stream = this.microphoneStream) {
    if (!stream) return;
    this.muteMicrophone(stream);
    stream.getTracks().forEach(track => { if (track.readyState !== 'ended') track.stop(); });
    if (this.microphoneStream === stream) this.microphoneStream = null;
  }
  parkMicrophone(session) {
    const stream = session.stream;
    session.stream = null;
    this.muteMicrophone(stream);
    if (stream && (stream !== this.microphoneStream || !this.usableMicrophone(stream))) this.discardMicrophone(stream);
  }
  releaseMicrophone() {
    // Permission prompts cannot be aborted, so invalidate any late grant as well.
    this.microphoneEpoch++;
    this.cancel();
    this.discardMicrophone();
  }
  cleanup(session) {
    this.clearTimer(session.timer);
    session.abort.abort();
    if (session.recorder) {
      session.recorder.onstart = session.recorder.ondataavailable = session.recorder.onstop = session.recorder.onerror = null;
      try { if (session.recorder.state !== 'inactive') session.recorder.stop(); } catch { this.discardMicrophone(session.stream); }
    }
    this.parkMicrophone(session);
    session.chunks = [];
    if (session.processing) this.transcriber?.cancel?.();
  }
  cancel() {
    const previous = this.session;
    this.session = null;
    if (previous) this.cleanup(previous);
    this.update({ phase: 'idle', message: '우측 버튼을 누르고 기다리세요.', transcript: '', language: '', tracks: [] });
  }
  fail(session, message) {
    if (this.session !== session) return;
    this.session = null;
    this.cleanup(session);
    this.update({ phase: 'error', message, tracks: [] });
  }
  async request(url, options, session, timeout = 45000) {
    const timer = this.setTimer(() => this.fail(session, '음성 요청 시간이 초과되었습니다. 다시 시도해 주세요.'), timeout);
    try {
      const response = await this.fetcher(url, { ...options, signal: session.abort.signal, cache: 'no-store' });
      let data;
      try { data = await response.json(); } catch { throw new Error('음성 서버에 연결할 수 없습니다. 운영자에게 설정을 확인해 주세요.'); }
      if (!response.ok) throw new Error(serverMessages[data?.error] || '음성 인식에 실패했습니다. 다시 시도해 주세요.');
      return data;
    } finally { this.clearTimer(timer); }
  }
  async begin() {
    if (this.active || !this.canStart()) return;
    const session = { abort: new AbortController(), chunks: [], bytes: 0, timer: null, held: true, started: false, device: this.deviceId(), microphoneEpoch: this.microphoneEpoch };
    this.session = session;
    this.update({ phase: 'preparing', message: '마이크 연결 중 · 아직 말하지 마세요.', transcript: '', language: '', tracks: [] });
    try {
      if (!this.mediaDevices?.getUserMedia || !this.Recorder) throw new Error('이 브라우저에서 녹음을 지원하지 않습니다. HTTPS와 마이크 권한을 확인해 주세요.');
      if (this.transcriber) {
        if (!this.transcriber.supported) throw new Error(this.transcriber.unavailableMessage || '래빗 Creation에서 음성 검색을 열어 주세요.');
        // Load in parallel; a cold model must not delay microphone permission/capture.
        Promise.resolve(this.transcriber.prepare?.()).catch(() => {});
      } else {
        const config = await this.request('/api/voice/config', {}, session, 10000);
        if (!this.current(session)) return;
        if (!config.enabled) throw new Error('음성 검색이 설정되지 않았습니다. 운영자가 Gemini API 키와 Spotify 사용자 허용 목록을 설정해야 합니다.');
      }
      let stream = this.microphoneStream;
      if (!this.usableMicrophone(stream)) {
        this.discardMicrophone(stream);
        // Permissions can resolve after release; that stream must never record or be cached.
        session.timer = this.setTimer(() => this.fail(session, '마이크 권한을 허용한 뒤 화면의 말하기 버튼을 다시 눌러 주세요.'), 30000);
        stream = await this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (!this.current(session) || !session.held || session.microphoneEpoch !== this.microphoneEpoch) { this.discardMicrophone(stream); return; }
        this.clearTimer(session.timer);
        this.muteMicrophone(stream);
        if (!this.usableMicrophone(stream)) { this.discardMicrophone(stream); throw new Error('마이크를 사용할 수 없습니다. 마이크 권한을 확인하고 다시 시도해 주세요.'); }
        this.microphoneStream = stream;
      }
      session.stream = stream;
      const mimeType = mimeTypes.find(type => this.Recorder.isTypeSupported?.(type));
      session.recorder = new this.Recorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      session.recorder.onstart = () => {
        if (!this.current(session) || !session.held || session.started) return;
        if (session.recorder.state !== 'recording' || !this.usableMicrophone(stream)) {
          this.discardMicrophone(stream);
          this.fail(session, '녹음을 시작하지 못했습니다. 버튼을 놓고 다시 눌러 주세요.');
          return;
        }
        this.clearTimer(session.timer);
        session.started = true;
        stream.getAudioTracks?.().forEach(track => { track.enabled = true; });
        if (!stream.getAudioTracks) stream.getTracks().forEach(track => { track.enabled = true; });
        session.timer = this.setTimer(() => this.release(), this.maxDuration);
        this.update({ phase: 'recording', message: '지금 말하세요' });
      };
      session.recorder.ondataavailable = event => {
        if (!this.current(session) || !session.started || !event.data?.size) return;
        session.bytes += event.data.size;
        if (session.bytes > this.maxBytes) { this.fail(session, '녹음 크기가 너무 큽니다. 더 짧게 말해 주세요.'); return; }
        session.chunks.push(event.data);
      };
      session.recorder.onerror = () => {
        if (!this.current(session)) return;
        this.discardMicrophone(stream);
        this.fail(session, '녹음하지 못했습니다. 마이크 권한을 확인하고 다시 시도해 주세요.');
      };
      session.recorder.onstop = () => {
        if (!this.current(session)) return;
        this.clearTimer(session.timer);
        if (session.held || !this.microphoneReady) {
          this.discardMicrophone(stream);
          this.fail(session, '녹음하지 못했습니다. 마이크 권한을 확인하고 다시 시도해 주세요.');
          return;
        }
        this.parkMicrophone(session);
        void this.process(session);
      };
      // start() returning only means the request was accepted. Signal readiness
      // when the recorder actually starts, with audio muted until that event.
      session.timer = this.setTimer(() => {
        if (!this.current(session) || session.started) return;
        this.discardMicrophone(stream);
        this.fail(session, '녹음을 시작하지 못했습니다. 버튼을 놓고 다시 눌러 주세요.');
      }, RECORDER_START_TIMEOUT_MS);
      session.recorder.start(250);
    } catch (error) {
      if (this.current(session) && session.stream) this.discardMicrophone(session.stream);
      if (this.current(session)) this.fail(session, ['NotAllowedError', 'SecurityError'].includes(error.name)
        ? '마이크 권한을 허용한 뒤 화면의 말하기 버튼을 다시 눌러 주세요.' : error.message);
    }
  }
  release() {
    const session = this.session;
    if (!session || !session.held) return;
    session.held = false;
    if (this.state.phase === 'preparing') {
      this.cancel();
      this.update({ message: '녹음 전에 버튼을 놓았습니다. 다시 누르고 “지금 말하세요”를 기다리세요.' });
      return;
    }
    if (this.state.phase !== 'recording') return;
    this.clearTimer(session.timer);
    this.update({ phase: 'transcribing', message: '언어를 감지하고 곡을 찾고 있습니다.' });
    const stream = session.stream;
    session.timer = this.setTimer(() => {
      if (!this.current(session)) return;
      this.discardMicrophone(stream);
      this.fail(session, '녹음하지 못했습니다. 마이크 권한을 확인하고 다시 시도해 주세요.');
    }, 5000);
    try { session.recorder.stop(); } catch {
      this.discardMicrophone(session.stream);
      this.fail(session, '녹음하지 못했습니다. 마이크 권한을 확인하고 다시 시도해 주세요.');
    }
    this.parkMicrophone(session);
  }
  async process(session) {
    try {
      this.update({ phase: 'transcribing', message: '언어를 감지하고 곡을 찾고 있습니다.' });
      const blob = new Blob(session.chunks, { type: session.recorder.mimeType || session.chunks[0]?.type || 'audio/webm' });
      session.chunks = [];
      if (!blob.size) throw new Error('녹음이 비어 있습니다. 버튼을 누른 채 말해 주세요.');
      if (blob.size > this.maxBytes) throw new Error('녹음 크기가 너무 큽니다. 더 짧게 말해 주세요.');
      let result;
      if (this.transcriber) {
        session.processing = true;
        this.update({ message: this.transcriber.ready ? '기기에서 음성을 글자로 바꾸고 있습니다. 잠시 기다려 주세요.' : '음성 기능을 처음 준비하고 있습니다. 녹음은 완료했습니다.' });
        try {
          result = await this.transcriber.recognize(blob, {
            signal: session.abort.signal,
            onTranscript: (transcript, language) => {
              if (this.current(session)) this.update({ phase: 'analyzing', message: '곡 정보를 확인하고 있습니다.', transcript, language });
            },
          });
        } catch (error) { throw new Error(keylessVoiceMessage(error)); }
        finally { session.processing = false; }
      } else {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!this.current(session)) return;
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        const accessToken = await this.client.voiceAccessToken();
        if (!this.current(session)) return;
        result = await this.request('/api/voice/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ audio: btoa(binary), mimeType: blob.type }),
        }, session);
      }
      if (!this.current(session)) return;
      if (typeof result.title !== 'string' || !result.title.trim() || typeof result.transcript !== 'string') throw new Error('곡명을 알아듣지 못했습니다. 가수와 곡명을 다시 말해 주세요.');
      session.request = { title: result.title.trim(), artist: typeof result.artist === 'string' ? result.artist.trim() : '',
        ...(typeof result.query === 'string' ? { query: result.query } : {}) };
      this.update({ phase: 'searching', message: 'Spotify에서 검색하고 있습니다.', transcript: result.transcript, language: typeof result.language === 'string' ? result.language : '' });
      const rawTracks = await this.client.searchTracks({ ...session.request, signal: session.abort.signal });
      if (!this.current(session)) return;
      const seen = new Set();
      const tracks = rawTracks.filter(track => {
        if (!/^spotify:track:[a-zA-Z0-9]{22}$/.test(track?.uri || '') || track.is_playable === false || seen.has(track.uri)) return false;
        seen.add(track.uri); return true;
      });
      const exact = exactVoiceTrack(tracks, session.request);
      const recovered = Boolean(result.requiresConfirmation) || tracks.some(track => track.voiceRecovery);
      if (exact && !recovered) { await this.play(session, exact); return; }
      if (!tracks.length) throw new Error('검색 결과가 없습니다. 가수와 곡명을 다시 말해 주세요.');
      session.tracks = tracks.slice(0, 5);
      this.update({ phase: 'choosing', message: recovered ? '곡명을 정확히 확인하지 못했습니다. 후보에서 선택해 주세요.' : '재생할 곡을 선택해 주세요.', tracks: session.tracks });
    } catch (error) { if (this.current(session)) this.fail(session, error.message); }
  }
  async choose(uri) {
    const session = this.session;
    if (!session || this.state.phase !== 'choosing') return;
    const track = session.tracks.find(item => item.uri === uri);
    if (track) await this.play(session, track);
  }
  async play(session, track) {
    if (!this.current(session)) return;
    if (!this.canStart()) { this.fail(session, 'Spotify를 연결해 주세요.'); return; }
    this.update({ phase: 'playing', message: '선택한 곡을 재생하고 있습니다.', tracks: [] });
    try {
      // Cancellation between search and playback never sends a playback command.
      if (!this.current(session)) return;
      await this.client.playTrack(track.uri, session.device, { signal: session.abort.signal });
      if (!this.current(session)) return;
      this.session = null;
      this.cleanup(session);
      this.update({ phase: 'done', message: '재생을 요청했습니다.', track });
    } catch (error) { if (this.current(session)) this.fail(session, error.message); }
  }
}
