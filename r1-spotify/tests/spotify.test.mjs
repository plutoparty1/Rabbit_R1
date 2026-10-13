// OAuth 및 재생 제어는 가짜 응답으로 검증하고 실제 계정은 사용하지 않습니다.
import assert from 'node:assert/strict';
import { SpotifyClient } from '../dist/spotify.mjs';

const values = new Map();
const storage = { get: async key => values.get(key) || null, set: async (key, value) => values.set(key, value), remove: async key => values.delete(key) };
const calls = [];
let deny = false, rateLimited = false;
const fetcher = async (url, options) => {
  calls.push({ url, ...options });
  if (url.includes('/api/token')) return new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, scope: 'user-read-playback-state user-modify-playback-state' }));
  if (rateLimited) return new Response('{}', { status: 429, headers: { 'Retry-After': '30' } });
  if (deny) { deny = false; return new Response('{}', { status: 401 }); }
  return options.method === 'GET' ? new Response(JSON.stringify({ item: null })) : new Response(null, { status: 204 });
};
const client = new SpotifyClient({ redirectUri: 'http://127.0.0.1:8791/', storage, fetcher });
await client.init();
await assert.rejects(() => client.player(), /로그인/);
const auth = new URL(await client.authorize('a'.repeat(32)));
assert.equal(auth.origin, 'https://accounts.spotify.com');
assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
assert.equal(auth.searchParams.get('redirect_uri'), 'http://127.0.0.1:8791/');
await assert.rejects(() => client.finish(new URL('http://127.0.0.1:8791/?code=fake&state=wrong')), /확인/);
assert.equal(calls.length, 0);
await client.finish(new URL('http://127.0.0.1:8791/?code=fake&state=' + auth.searchParams.get('state')));
assert.equal(client.connected, true);
assert.equal(calls[0].body.get('grant_type'), 'authorization_code');
assert.ok(calls[0].body.get('code_verifier').length >= 43);
assert.equal(calls[0].body.has('client_secret'), false);
await assert.rejects(() => client.finish(new URL('http://127.0.0.1:8791/?code=fake&state=' + auth.searchParams.get('state'))), /확인/);
await client.control('next');
assert.equal(calls.at(-1).method, 'POST');
assert.equal(calls.at(-1).url, 'https://api.spotify.com/v1/me/player/next');
assert.equal(calls.at(-1).headers.Authorization, 'Bearer access-test');
await assert.rejects(() => client.control('anything'), /지원/);
// 볼륨 API의 범위·정수 검사와 기기 지정값의 안전한 인코딩을 검증합니다.
await client.volume(55, 'speaker & room');
assert.equal(calls.at(-1).method, 'PUT');
const volumeUrl = new URL(calls.at(-1).url);
assert.equal(volumeUrl.pathname, '/v1/me/player/volume');
assert.equal(volumeUrl.searchParams.get('volume_percent'), '55');
assert.equal(volumeUrl.searchParams.get('device_id'), 'speaker & room');
for (const volume of [0, 100]) {
  await client.volume(volume);
  assert.equal(new URL(calls.at(-1).url).searchParams.get('volume_percent'), String(volume));
  assert.equal(new URL(calls.at(-1).url).searchParams.has('device_id'), false);
}
const beforeInvalidVolume = calls.length;
for (const volume of [-1, 101, NaN, Infinity, 5.5, null, '50']) await assert.rejects(() => client.volume(volume), /볼륨/);
assert.equal(calls.length, beforeInvalidVolume);
deny = true;
await client.player();
assert.equal(calls.filter(call => call.url.includes('/api/token')).length, 2);
rateLimited = true;
await assert.rejects(() => client.player(), error => error.retryAfter >= 30);
const before = calls.length;
await assert.rejects(() => client.control('next'), error => error.retryAfter > 0);
await assert.rejects(() => client.volume(50), error => error.retryAfter > 0);
assert.equal(calls.length, before);
await client.disconnect();
assert.equal(client.connected, false);
assert.equal(values.size, 0);
// 로그인 준비 정보는 유효 기간이 지나면 다음 실행에서 폐기합니다.
values.set('r1_spotify_pkce_v1', { state: 'expired-test', expires: Date.now() - 1 });
const expiredClient = new SpotifyClient({ redirectUri: 'http://127.0.0.1:8791/', storage, fetcher });
await expiredClient.init();
assert.equal(expiredClient.authorizationPending, false);
assert.equal(values.size, 0);
// 실제 기기 대신 기본 저장소와 래빗 보안 저장소의 복원 경로를 검증합니다.
const makeStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), clear: () => data.clear() };
};
globalThis.localStorage = makeStorage(); globalThis.sessionStorage = makeStorage();
const secureValues = new Map();
globalThis.window = { creationStorage: { secure: {
  getItem: async key => secureValues.get(key) ?? null,
  setItem: async (key, value) => secureValues.set(key, value),
  removeItem: async key => secureValues.delete(key),
} } };
const nativeClient = new SpotifyClient({ redirectUri: 'http://127.0.0.1:8791/', fetcher });
await nativeClient.save({ access_token: 'native-test', refresh_token: 'native-refresh', clientId: 'a'.repeat(32), expires_in: 3600 });
assert.equal(JSON.parse(atob(secureValues.get('r1_spotify_tokens_v1'))).access_token, 'native-test');
sessionStorage.clear();
const reopened = new SpotifyClient({ redirectUri: 'http://127.0.0.1:8791/', fetcher });
await reopened.init(); assert.equal(reopened.connected, true);
assert.equal(localStorage.getItem('r1_spotify_tokens_v1'), null);
await reopened.disconnect(); assert.equal(secureValues.size, 0);
sessionStorage.clear(); await reopened.init(); assert.equal(reopened.connected, false);
// 손상된 저장값이 있으면 로그인 화면으로 돌아가며 앱 실행을 중단하지 않습니다.
secureValues.set('r1_spotify_tokens_v1', 'invalid-base64');
await reopened.init(); assert.equal(reopened.connected, false);
console.log('OAuth 상태·PKCE·토큰 갱신·기기 로그인 복원·허용 명령·요청 제한 검사 통과');
