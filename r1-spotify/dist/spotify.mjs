import { rankSongCandidates } from './song-request.mjs';

// Only the non-secret device choice is persisted for shared-device sessions.
const MODE_KEY = 'r1_spotify_device_mode';
let memoryTokens = null;
export function getSessionMode() {
  try { return sessionStorage.getItem(MODE_KEY) || localStorage.getItem(MODE_KEY) || 'personal'; }
  catch { return 'shared'; }
}
export async function setSessionMode(mode) {
  if (!['personal', 'shared'].includes(mode)) throw new Error('기기 사용 방식을 선택해 주세요.');
  if (mode !== getSessionMode()) {
    await deviceStore.remove(TOKEN_KEY);
    await deviceStore.remove(PENDING_KEY);
    try { localStorage.removeItem('r1_spotify_personal_client_id'); localStorage.removeItem('r1_spotify_client_id'); } catch {}
  }
  try { sessionStorage.setItem(MODE_KEY, mode); } catch {}
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  if (getSessionMode() !== mode) throw new Error('기기 사용 방식을 저장할 수 없습니다.');
}
// 래빗 저장소가 응답하지 않아도 로그인 화면과 콜백 처리가 멈추지 않도록 제한합니다.
async function secureCall(operation) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('래빗 보안 저장소가 응답하지 않습니다.')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

// WebView가 늦게 주입하는 보안 저장소를 제한된 시간 안에서 다시 확인합니다.
async function secureStore() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const secure = globalThis.window?.creationStorage?.secure;
    if (secure || !globalThis.window) return secure;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return globalThis.window?.creationStorage?.secure;
}

// 보안 저장소가 없는 브라우저와 응답하지 않는 래빗에서도 기기 내부에 로그인 정보를 보관합니다.
function tokenRecord(method, value) {
  return new Promise((resolve, reject) => {
    let database, transaction, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { try { transaction?.abort(); } catch { /* 이미 완료된 작업은 취소할 필요가 없습니다. */ } }
      database?.close();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('기기 저장소가 응답하지 않습니다.')), 2000);
    let opening;
    try { opening = indexedDB.open('r1_spotify', 1); }
    catch (error) { finish(error); return; }
    opening.onupgradeneeded = () => opening.result.createObjectStore('tokens');
    opening.onerror = () => finish(opening.error);
    opening.onblocked = () => finish(new Error('기기 저장소를 열 수 없습니다.'));
    opening.onsuccess = () => {
      database = opening.result;
      if (settled) { database.close(); return; }
      try {
        transaction = database.transaction('tokens', method === 'get' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('tokens');
        const request = method === 'put' ? store.put(value, TOKEN_KEY) : store[method](TOKEN_KEY);
        transaction.oncomplete = () => finish(null, request.result);
        transaction.onabort = transaction.onerror = () => finish(transaction.error || new Error('기기 저장에 실패했습니다.'));
      } catch (error) { finish(error); }
    };
  });
}

// 로그인 준비 정보만 localStorage에 두며, 토큰은 보안 저장소 또는 같은 출처의 IndexedDB에 보관합니다.
const deviceStore = {
  notice: '로그인 유지 상태를 확인하고 있습니다.',
  async get(key) {
    if (getSessionMode() === 'shared') {
      if (key === TOKEN_KEY) return memoryTokens;
      try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
    }
    const local = key === PENDING_KEY ? localStorage.getItem(key) : null;
    let session;
    try { session = sessionStorage.getItem(key); } catch { /* 탭 저장이 제한되어도 기기 저장소를 확인합니다. */ }
    if (local || session) { try { return JSON.parse(local || session); } catch { /* 손상된 임시 값 대신 기기 저장소를 확인합니다. */ } }
    if (key === PENDING_KEY) return null;
    // 보안 저장에 실패한 최신 토큰 또는 명시적 연결 해제 기록이 이전 보안 값을 덮어씁니다.
    try { const saved = await tokenRecord('get'); if (saved !== undefined) return saved; } catch { /* 기기 저장소를 사용할 수 없으면 보안 저장소를 확인합니다. */ }
    const secure = await secureStore();
    if (!secure) return null;
    try { const raw = await secureCall(() => secure.getItem(key)); return raw ? JSON.parse(atob(raw)) : null; }
    catch { return null; }
  },
  async set(key, value) {
    if (getSessionMode() === 'shared') {
      if (key === PENDING_KEY) { sessionStorage.setItem(key, JSON.stringify(value)); return; }
      memoryTokens = value;
      this.notice = '공용 기기: 로그인은 현재 화면에서만 유지됩니다.';
      return;
    }
    if (key === PENDING_KEY) { localStorage.setItem(key, JSON.stringify(value)); return; }
    // 보안 저장소의 성공 응답만 믿고 기기 백업을 삭제하지 않습니다.
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* 탭 저장이 제한되어도 기기 저장을 계속합니다. */ }
    let saved = false;
    try { await tokenRecord('put', value); saved = true; } catch { /* 기기 저장이 제한된 환경에서는 보안 저장소를 사용합니다. */ }
    const secure = await secureStore();
    if (secure) {
      try {
        const encoded = btoa(JSON.stringify(value));
        await secureCall(() => secure.setItem(key, encoded));
        // 다른 영구 저장소가 없으면 읽기 검증까지 성공해야 로그인 유지로 안내합니다.
        if (!saved) saved = await secureCall(() => secure.getItem(key)) === encoded;
      } catch { /* 보안 저장이 응답하지 않으면 기기 저장소의 최신 값을 유지합니다. */ }
    }
    this.notice = saved ? '로그인 유지: 기기 저장을 확인했습니다.' : '로그인 유지 저장에 실패했습니다. 이 환경에서는 다음 실행에 다시 연결해야 합니다.';
  },
  async remove(key) {
    if (key === TOKEN_KEY) memoryTokens = null;
    if (key === PENDING_KEY) localStorage.removeItem(key);
    try { sessionStorage.removeItem(key); } catch { /* 다른 저장소의 연결 해제도 계속합니다. */ }
    if (key === PENDING_KEY) return;
    // null 기록은 보안 저장소의 삭제 실패 후에도 이전 로그인이 되살아나는 것을 막습니다.
    let cleared = false;
    try { await tokenRecord('put', null); cleared = true; } catch { /* 보안 저장소의 삭제도 시도합니다. */ }
    const secure = await secureStore();
    if (secure) { try { await secureCall(() => secure.removeItem(key)); } catch (error) { if (!cleared) throw error; } }
  },
};
const TOKEN_KEY = 'r1_spotify_tokens_v1', PENDING_KEY = 'r1_spotify_pkce_v1';
const SCOPE = 'user-read-playback-state user-modify-playback-state user-read-private';
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// 지원되지 않는 최신 타임아웃 API 대신 요청 본문 처리까지 취소 타이머를 유지합니다.
export async function requestJson(url, options = {}, fetcher = fetch, timeoutMs = 10000) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const response = await fetcher(url, { ...options, signal: controller.signal });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { response, body };
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}

export class SpotifyClient {
  constructor({ redirectUri, storage = deviceStore, fetcher = fetch }) {
    this.redirectUri = redirectUri; this.storage = storage; this.fetcher = fetcher;
    this.tokens = null; this.refreshing = null; this.generation = 0; this.blockedUntil = 0;
  }
  get connected() { return Boolean(this.tokens?.refresh_token && this.tokens?.access_token); }
  async init() {
    this.tokens = await this.storage.get(TOKEN_KEY);
    // 기존 탭에만 남아 있는 로그인 정보도 이번 실행부터 기기에 보관합니다.
    if (this.connected) await this.storage.set(TOKEN_KEY, this.tokens);
    let pending = await this.storage.get(PENDING_KEY);
    if (pending && pending.expires <= Date.now()) {
      await this.storage.remove(PENDING_KEY); pending = null;
    }
    this.authorizationPending = Boolean(pending && pending.expires > Date.now());
  }

  // 서버 비밀번호 없이 PKCE와 일회용 상태값으로 같은 기기의 로그인 요청을 검증합니다.
  async authorize(clientId) {
    if (!/^[a-f\d]{32}$/i.test(clientId)) throw new Error('Client ID 32자리를 확인해 주세요.');
    const verifier = random(), state = random();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await this.storage.set(PENDING_KEY, { verifier, state, clientId, redirectUri: this.redirectUri, expires: Date.now() + 600000 });
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: this.redirectUri,
      scope: SCOPE, state, code_challenge_method: 'S256', code_challenge: challenge });
    return url.href;
  }
  async finish(url) {
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return false;
    const pending = await this.storage.get(PENDING_KEY);
    if (!pending || pending.expires < Date.now() || pending.state !== url.searchParams.get('state') || pending.redirectUri !== this.redirectUri) {
      throw new Error('로그인 요청을 확인할 수 없습니다. 이 기기에서 다시 로그인해 주세요.');
    }
    // 일회용 정보는 콜백 검증 뒤 먼저 폐기하며 이전 SDK 저장소의 정리는 완료를 막지 않습니다.
    try { await this.storage.remove(PENDING_KEY); } catch { /* 출처 저장소의 준비 정보는 이미 폐기되었습니다. */ }
    this.authorizationPending = false;
    if (url.searchParams.has('error')) throw new Error('Spotify 연결이 취소되었습니다.');
    const tokens = await this.exchange({ client_id: pending.clientId, grant_type: 'authorization_code',
      code: url.searchParams.get('code'), redirect_uri: this.redirectUri, code_verifier: pending.verifier });
    await this.save({ ...tokens, clientId: pending.clientId });
    return true;
  }
  async exchange(fields) {
    const { response, body } = await requestJson('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
    }, this.fetcher);
    if (!response.ok || !body?.access_token || !(body.expires_in > 0)) {
      if (body?.error === 'invalid_grant') await this.disconnect();
      throw new Error('Spotify 로그인을 완료할 수 없습니다. 앱 설정과 계정을 확인해 주세요.');
    }
    return body;
  }
  async save(tokens) {
    this.tokens = { ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 - 30000 };
    await this.storage.set(TOKEN_KEY, this.tokens);
  }
  async refresh() {
    if (!this.connected) throw new Error('Spotify 로그인이 필요합니다.');
    if (!this.refreshing) {
      const generation = this.generation, old = this.tokens;
      this.refreshing = (async () => {
        const tokens = await this.exchange({ client_id: old.clientId, grant_type: 'refresh_token', refresh_token: old.refresh_token });
        if (generation !== this.generation) throw new Error('연결이 해제되었습니다.');
        await this.save({ ...old, ...tokens });
      })().finally(() => { this.refreshing = null; });
    }
    await this.refreshing;
  }
  async api(path, method = 'GET', retry = true) {
    return this.request('/me/player' + path, { method, retry });
  }
  async voiceAccessToken() {
    const token = await this.accessToken();
    if (typeof this.tokens.scope === 'string' && !this.tokens.scope.split(/\s+/).includes('user-read-private')) {
      throw new Error('음성 검색 권한이 필요합니다. 연결 설정에서 Spotify에 다시 로그인해 주세요.');
    }
    return token;
  }
  async accessToken() {
    const generation = this.generation;
    if (!this.connected) throw new Error('Spotify 로그인이 필요합니다.');
    if (this.tokens.expiresAt <= Date.now()) await this.refresh();
    if (generation !== this.generation || !this.connected) throw new Error('연결이 해제되었습니다.');
    return this.tokens.access_token;
  }
  async request(path, { method = 'GET', retry = true, data, signal } = {}) {
    const generation = this.generation;
    if (!this.connected) throw new Error('Spotify 로그인이 필요합니다.');
    if (Date.now() < this.blockedUntil) {
      const error = new Error('Spotify 요청 제한입니다. 잠시 기다려 주세요.');
      error.retryAfter = Math.ceil((this.blockedUntil - Date.now()) / 1000); throw error;
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const accessToken = await this.accessToken();
    if (generation !== this.generation) throw new Error('연결이 해제되었습니다.');
    const { response, body } = await requestJson('https://api.spotify.com/v1' + path, {
      method, signal, headers: { Authorization: 'Bearer ' + accessToken, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }, this.fetcher);
    if (generation !== this.generation) throw new Error('연결이 해제되었습니다.');
    if (response.status === 401 && retry) { await this.refresh(); return this.request(path, { method, retry: false, data, signal }); }
    if (response.status === 429) {
      const seconds = Math.max(1, Number(response.headers.get('Retry-After')) || 30);
      this.blockedUntil = Date.now() + seconds * 1000;
      const error = new Error('Spotify 요청 제한입니다. 잠시 기다려 주세요.'); error.retryAfter = seconds; throw error;
    }
    if (response.status === 401) { await this.disconnect(); throw new Error('Spotify에 다시 로그인해 주세요.'); }
    if (response.status === 403) throw new Error('재생 권한이 없습니다. Premium·앱 등록 계정·기기 제한을 확인해 주세요.');
    if (response.status === 404) throw new Error('Spotify 앱에서 곡을 먼저 재생해 주세요.');
    if (!response.ok) throw new Error('Spotify 요청에 실패했습니다. 연결 상태를 확인해 주세요.');
    return body;
  }
  async searchTracks({ title, artist = '', signal } = {}) {
    if (typeof title !== 'string' || !title.trim() || title.length > 300 || typeof artist !== 'string' || artist.length > 300) {
      throw new Error('곡 제목과 가수 이름을 확인해 주세요.');
    }
    const clean = value => value.replace(/["\\\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
    const trackName = clean(title), artistName = clean(artist);
    if (!trackName) throw new Error('곡 제목과 가수 이름을 확인해 주세요.');
    const query = 'track:"' + trackName + '"' + (artistName ? ' artist:"' + artistName + '"' : '');
    const search = async (q, limit = 5) => {
      const result = await this.request('/search?' + new URLSearchParams({ q, type: 'track', limit: String(limit) }), { signal });
      const seen = new Set();
      return (Array.isArray(result?.tracks?.items) ? result.tracks.items : []).filter(track => {
        if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(track?.uri) || !track.name || !Array.isArray(track.artists) ||
            track.is_local || track.is_playable === false || track.restrictions?.reason || seen.has(track.uri)) return false;
        seen.add(track.uri); return true;
      }).slice(0, limit);
    };
    const matches = await search(query);
    // Broader candidates can be chosen by the user; they are never assumed to be an exact match.
    if (matches.length) return matches;
    const broad = await search([trackName, artistName].filter(Boolean).join(' '));
    if (broad.length || !artistName) return broad;
    // A small recognizer can preserve the artist while damaging the title. Offer
    // actual catalog choices rather than inventing a corrected song or replaying
    // a guessed match. The controller must require a tap for voiceRecovery tracks.
    const catalog = await search('artist:"' + artistName + '"', 10);
    return rankSongCandidates(catalog, { title: trackName }).slice(0, 5)
      .map(track => ({ ...track, voiceRecovery: true }));
  }
  async playTrack(uri, deviceId, { signal } = {}) {
    if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) throw new Error('유효한 Spotify 곡을 선택해 주세요.');
    const query = deviceId ? '?' + new URLSearchParams({ device_id: deviceId }) : '';
    return this.request('/me/player/play' + query, { method: 'PUT', data: { uris: [uri] }, signal });
  }
  async player() { return this.api(''); }
  // Spotify의 실제 재생 기기에 0~100 정수 볼륨을 적용하며 기존 인증·요청 제한 처리를 재사용합니다.
  async volume(percent, deviceId) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('볼륨은 0부터 100까지의 정수여야 합니다.');
    const query = new URLSearchParams({ volume_percent: String(percent) });
    if (deviceId) query.set('device_id', deviceId);
    return this.api('/volume?' + query, 'PUT');
  }
  async control(action) {
    const command = { next: ['POST', '/next'], previous: ['POST', '/previous'], play: ['PUT', '/play'], pause: ['PUT', '/pause'] }[action];
    if (!command) throw new Error('지원하지 않는 재생 동작입니다.');
    return this.api(command[1], command[0]);
  }
  async disconnect() {
    this.generation++; this.tokens = null; this.blockedUntil = 0; this.authorizationPending = false;
    await this.storage.remove(TOKEN_KEY); await this.storage.remove(PENDING_KEY);
  }
}

// 외부 응답에서 문자열 가사만 허용하여 손상된 값이 화면 처리를 중단하지 않도록 합니다.
function lyricResult(value, source) {
  const syncedLyrics = typeof value?.syncedLyrics === 'string' && value.syncedLyrics.trim() ? value.syncedLyrics : null;
  const plainLyrics = typeof value?.plainLyrics === 'string' && value.plainLyrics.trim() ? value.plainLyrics : null;
  const instrumental = value?.instrumental === true;
  return syncedLyrics || plainLyrics || instrumental ? { syncedLyrics, plainLyrics, instrumental, source } : null;
}

// 표기상 공백·대소문자 차이만 허용하며 라이브·리믹스 등의 버전명은 제거하지 않습니다.
const lyricName = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';

// Spotify 웹 가사를 우선하고, 기기 언어에 맞는 외부 제공처로 이어갑니다.
export async function getLyrics(player, locale = 'ko') {
  const language = /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(locale) ? locale.split(/[-_]/)[0].toLowerCase() : 'en';
  const trackId = String(player.id || '').replace(/^spotify:track:/, '');
  if (/^[a-zA-Z0-9]{22}$/.test(trackId)) {
    try {
      const query = new URLSearchParams({ track_id: trackId, language });
      const spotify = await requestJson('/api/lyrics/spotify?' + query, {}, fetch, 10000);
      if (spotify.response.ok) {
        const result = lyricResult(spotify.body, 'Spotify');
        if (result) return result;
      }
    } catch { /* 선택적인 웹 세션 조회가 실패해도 외부 가사를 확인합니다. */ }
  }
  const url = new URL('https://lrclib.net/api/get');
  url.search = new URLSearchParams({ track_name: player.title, artist_name: player.primaryArtist,
    album_name: player.album, duration: String(Math.round(player.duration / 1000)) });
  const message = '가사를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.';
  let failed = false;
  const bugsLyrics = async () => {
    try {
      const query = new URLSearchParams({ title: player.title, artist: player.primaryArtist, album: player.album,
        duration: String(Math.round(player.duration / 1000)) });
      // 벅스 검색·곡 길이·가사를 서버에서 확인하는 동안에는 최대 25초까지 기다립니다.
      const bugs = await requestJson('/api/lyrics/bugs?' + query, {}, fetch, 25000);
      if (bugs.response.ok) {
        const result = lyricResult(bugs.body, '벅스');
        if (!result) throw new Error(message);
        return result;
      }
      if (bugs.response.status !== 404) throw new Error(message);
    } catch { failed = true; }
    return null;
  };
  if (language === 'ko') {
    const result = await bugsLyrics();
    if (result) return result;
  }
  try {
    const { response, body } = await requestJson(url.href);
    if (!response.ok && response.status !== 404) throw new Error(message);
    const exact = response.ok ? lyricResult(body, 'LRCLIB') : null;
    if (exact) return exact;

    // 앨범 재발매 차이는 허용하되 제목·가수·길이가 다른 가사를 자동 선택하지 않습니다.
    url.pathname = '/api/search';
    url.search = new URLSearchParams({ track_name: player.title, artist_name: player.primaryArtist });
    const search = await requestJson(url.href);
    if (!search.response.ok || !Array.isArray(search.body)) throw new Error(message);
    const matches = search.body.filter(item => item && !item.instrumental &&
      lyricName(item.trackName) === lyricName(player.title) && lyricName(item.artistName) === lyricName(player.primaryArtist) &&
      Number.isFinite(item.duration) && Math.abs(item.duration - player.duration / 1000) <= 2 && lyricResult(item, 'LRCLIB'));
    const rank = item => (typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim() ? 4 : 0) +
      (lyricName(item.albumName) === lyricName(player.album) ? 2 : 0);
    matches.sort((a, b) => rank(b) - rank(a) || Math.abs(a.duration - player.duration / 1000) - Math.abs(b.duration - player.duration / 1000));
    if (matches.length) return lyricResult(matches[0], 'LRCLIB');
  } catch { failed = true; }

  if (language !== 'ko') {
    const result = await bugsLyrics();
    if (result) return result;
  }

  // 대체 제공처에는 제목과 가수만 보내며 Spotify 인증값을 전달하지 않습니다.
  try {
    const { response, body } = await requestJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(player.primaryArtist)}/${encodeURIComponent(player.title)}`);
    if (response.status === 404) { if (failed) throw new Error(message); return null; }
    if (!response.ok || typeof body?.lyrics !== 'string') throw new Error(message);
    const result = lyricResult({ plainLyrics: body.lyrics }, 'lyrics.ovh');
    if (!result && failed) throw new Error(message);
    return result;
  } catch { throw new Error(message); }
}
