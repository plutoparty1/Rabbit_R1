import test from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyClient } from '../dist/spotify.mjs';

const uri = 'spotify:track:' + 'a'.repeat(22);
const track = { uri, name: '밤편지', artists: [{ name: '아이유' }] };
const storage = { set: async () => {}, remove: async () => {} };
function makeClient(fetcher) {
  const client = new SpotifyClient({ redirectUri: 'https://app.test/', storage, fetcher });
  client.tokens = { access_token: 'access', refresh_token: 'refresh', expiresAt: Date.now() + 60000, clientId: 'test' };
  return client;
}
const json = data => Response.json(data);

test('search sends artist/title filters to /v1/search and filters unusable/duplicate results', async () => {
  const calls = [];
  const client = makeClient(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: [track, track, { ...track, uri: 'spotify:episode:bad' },
      { ...track, uri: 'spotify:track:' + 'b'.repeat(22), is_playable: false }, null] } });
  });
  assert.deepEqual(await client.searchTracks({ title: '밤편지', artist: '아이유' }), [track]);
  assert.equal(calls[0].url.pathname, '/v1/search');
  assert.equal(calls[0].url.searchParams.get('q'), 'track:"밤편지" artist:"아이유"');
  assert.equal(calls[0].url.searchParams.get('type'), 'track');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer access');
});

test('empty filtered search offers broad candidates without issuing playback', async () => {
  const calls = [];
  const client = makeClient(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: calls.length === 1 ? [] : [track] } });
  });
  assert.deepEqual(await client.searchTracks({ title: 'Cruel Summer', artist: '테일러 스위프트' }), [track]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get('q'), 'Cruel Summer 테일러 스위프트');
  assert.ok(calls.every(call => call.options.method === 'GET'));
});

test('unstructured speech makes one broad query and only offers selectable filtered candidates', async () => {
  const calls = [];
  const client = makeClient(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: [track, track, { ...track, uri: 'spotify:episode:bad' },
      { ...track, uri: 'spotify:track:' + 'b'.repeat(22), is_playable: false }] } });
  });
  const results = await client.searchTracks({ query: '아이유 "밤편지"' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('q'), '아이유 밤편지');
  assert.equal(calls[0].url.searchParams.get('limit'), '5');
  assert.equal(calls[0].url.searchParams.get('type'), 'track');
  assert.deepEqual(results, [{ ...track, voiceRecovery: true }]);
  assert.equal(track.voiceRecovery, undefined);
  assert.equal(calls[0].options.method, 'GET');
});

test('empty free-text searches stop after one request without guessed artist fallback', async () => {
  let calls = 0;
  const client = makeClient(async () => { calls++; return json({ tracks: { items: [] } }); });
  assert.deepEqual(await client.searchTracks({ title: 'heard words', artist: 'ignored artist', query: 'heard words' }), []);
  assert.equal(calls, 1);
});

test('free-text validation and cancellation prevent requests or late candidates', async () => {
  let calls = 0;
  const client = makeClient(async () => { calls++; return json({ tracks: { items: [track] } }); });
  for (const input of [{ query: '' }, { query: '   ' }, { query: '"\\' }, { query: null },
    { query: {} }, { query: 'x'.repeat(301) }, { query: 'song', title: {} }, { query: 'song', artist: {} }]) {
    await assert.rejects(client.searchTracks(input));
  }
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(client.searchTracks({ query: 'song', signal: cancelled.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  const duringFetch = new AbortController();
  client.fetcher = async () => { calls++; duringFetch.abort(); return json({ tracks: { items: [track] } }); };
  await assert.rejects(client.searchTracks({ query: 'song', signal: duringFetch.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('garbled title can recover actual artist catalog choices, always marked for confirmation', async () => {
  const calls = [];
  const candidates = ['팔레트', '밤편지 (Live)', '밤편지', '좋은 날'].map((name, index) => ({
    uri: 'spotify:track:' + String.fromCharCode(97 + index).repeat(22), name, artists: [{ name: 'IU' }],
  }));
  const client = makeClient(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: calls.length === 3 ? candidates : [] } });
  });
  const matches = await client.searchTracks({ title: '편벤지트로저', artist: 'IU' });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url.searchParams.get('q'), 'artist:"IU"');
  assert.equal(calls[2].url.searchParams.get('limit'), '10');
  assert.equal(matches[0].name, '밤편지');
  assert.ok(matches.every(item => item.voiceRecovery === true));
  assert.ok(candidates.every(item => item.voiceRecovery === undefined));
  assert.ok(calls.every(call => call.options.method === 'GET'));
});

test('empty title-only searches never broaden to an arbitrary artist catalog', async () => {
  const calls = [];
  const client = makeClient(async url => { calls.push(url); return json({ tracks: { items: [] } }); });
  assert.deepEqual(await client.searchTracks({ title: 'unrecognized words' }), []);
  assert.equal(calls.length, 2);
});

test('cancellation after broad search prevents the artist recovery request', async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = makeClient(async () => {
    calls++;
    if (calls === 2) controller.abort();
    return json({ tracks: { items: [] } });
  });
  await assert.rejects(client.searchTracks({ title: 'garbled', artist: 'known artist', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('play sends track URI JSON and safely encoded device; 401 refresh retains payload', async () => {
  const calls = [];
  const client = makeClient(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/api/token')) return json({ access_token: 'new-access', expires_in: 3600 });
    if (calls.length === 1) return new Response(null, { status: 401 });
    return new Response(null, { status: 204 });
  });
  await client.playTrack(uri, 'speaker & room');
  const playback = calls.filter(call => !call.url.includes('/api/token'));
  assert.equal(playback.length, 2);
  for (const call of playback) {
    assert.equal(new URL(call.url).pathname, '/v1/me/player/play');
    assert.equal(new URL(call.url).searchParams.get('device_id'), 'speaker & room');
    assert.equal(call.options.method, 'PUT');
    assert.deepEqual(JSON.parse(call.options.body), { uris: [uri] });
  }
  assert.equal(playback[1].options.headers.Authorization, 'Bearer new-access');
});

test('player state is fetched without HTTP caching and remains compatible with callers without options', async () => {
  const calls = [];
  const current = { is_playing: true, device: { id: 'current-device', name: 'Speaker' }, item: track };
  const client = makeClient(async (url, options) => { calls.push({ url: new URL(url), options }); return json(current); });
  assert.deepEqual(await client.player(), current);
  const controller = new AbortController();
  assert.deepEqual(await client.player({ signal: controller.signal }), current);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url.pathname, '/v1/me/player');
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.body, undefined);
  }
});

test('cancelled player-state lookups cannot return a late playback confirmation', async () => {
  let calls = 0;
  const client = makeClient(async () => { calls++; return json({ is_playing: true, item: track }); });
  const before = new AbortController(); before.abort();
  await assert.rejects(client.player({ signal: before.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  const during = new AbortController();
  client.fetcher = async (url, options) => {
    calls++; during.abort();
    assert.equal(options.signal.aborted, true);
    return json({ is_playing: true, item: track });
  };
  await assert.rejects(client.player({ signal: during.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('player-state authentication refresh retains no-store and cancellation options', async () => {
  const calls = [], controller = new AbortController();
  const client = makeClient(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/api/token')) return json({ access_token: 'fresh', expires_in: 3600 });
    if (calls.length === 1) return new Response(null, { status: 401 });
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return json({ is_playing: true, item: track });
  });
  await assert.rejects(client.player({ signal: controller.signal }), { name: 'AbortError' });
  const lookups = calls.filter(call => !call.url.includes('/api/token'));
  assert.equal(lookups.length, 2);
  assert.ok(lookups.every(call => call.options.cache === 'no-store'));
});

test('invalid input cannot send requests and cancellation does not start a fallback', async () => {
  let calls = 0;
  const client = makeClient(async () => { calls++; return json({ tracks: { items: [] } }); });
  for (const input of [{}, { title: '' }, { title: 'x'.repeat(301) }, { title: 'x', artist: {} }]) {
    await assert.rejects(client.searchTracks(input));
  }
  await assert.rejects(client.playTrack('https://example.test/'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.searchTracks({ title: 'song', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('late search response after disconnect cannot become a candidate or trigger fallback', async () => {
  let finish, calls = 0;
  const client = makeClient(async () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const pending = client.searchTracks({ title: 'song' });
  await new Promise(resolve => setImmediate(resolve));
  await client.disconnect(); finish(json({ tracks: { items: [] } }));
  await assert.rejects(pending, /연결/);
  assert.equal(calls, 1);
});

test('transient playback failures are never retried; Spotify backoff applies to voice search', async () => {
  let calls = 0;
  const client = makeClient(async () => { calls++; return new Response(null, { status: 503 }); });
  await assert.rejects(client.playTrack(uri));
  assert.equal(calls, 1);
  client.fetcher = async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '10' } }); };
  await assert.rejects(client.searchTracks({ title: 'song' }), error => error.retryAfter === 10);
  await assert.rejects(client.playTrack(uri), error => error.retryAfter > 0);
  assert.equal(calls, 2);
});

test('voice token accessor refreshes expiration without exposing refresh token', async () => {
  const client = makeClient(async () => json({ access_token: 'fresh', expires_in: 3600 }));
  client.tokens.expiresAt = 0;
  assert.equal(await client.voiceAccessToken(), 'fresh');
  await client.disconnect();
  await assert.rejects(client.voiceAccessToken(), /로그인/);
});

test('old grants retain playback but voice asks for new consent without sending audio', async () => {
  const client = makeClient(async () => new Response(null, { status: 204 }));
  client.tokens.scope = 'user-read-playback-state user-modify-playback-state';
  await client.control('pause');
  await assert.rejects(client.voiceAccessToken(), /다시 로그인/);
  client.tokens.scope += ' user-read-private';
  assert.equal(await client.voiceAccessToken(), 'access');
});
