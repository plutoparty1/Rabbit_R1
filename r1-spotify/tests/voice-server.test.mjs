import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceHandler } from '../server/voice.mjs';

const env = { GEMINI_API_KEY: 'provider-secret', VOICE_ALLOWED_SPOTIFY_USERS: 'allowed-id' };
const input = { audio: btoa('fake audio bytes'), mimeType: 'audio/webm;codecs=opus' };
const answer = { isMusicRequest: true, transcript: '아이유의 밤편지 틀어줘', language: 'ko', artist: '아이유', title: '밤편지' };
const result = value => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
function request(body = input, extra = {}) {
  return new Request('https://app.test/api/voice/search', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.test', Authorization: 'Bearer spotify-user-token', ...extra },
    body: JSON.stringify(body) });
}
function fixture({ profile = { id: 'allowed-id', account_id: 'stable-account' }, output = answer, providerStatus = 200, clock } = {}) {
  const calls = [];
  const handler = createVoiceHandler({ now: clock || Date.now, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (url === 'https://api.spotify.com/v1/me') return Response.json(profile);
    return providerStatus === 200 ? result(output) : new Response('private upstream details', { status: providerStatus });
  } });
  return { handler, calls };
}

test('voice config fails closed without key and allowed users; no secrets or identity list returned', async () => {
  const { handler, calls } = fixture();
  for (const config of [{}, { GEMINI_API_KEY: 'provider-secret' }, { ...env, VOICE_MODEL: '../secret' }, { ...env, VOICE_ALLOWED_SPOTIFY_USERS: '' }]) {
    const response = await handler(new Request('https://app.test/api/voice/config'), config);
    assert.deepEqual(await response.json(), { enabled: false });
    assert.equal((await handler(request(), config)).status, 503);
  }
  const response = await handler(new Request('https://app.test/api/voice/config'), env);
  assert.deepEqual(await response.json(), { enabled: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);
  assert.equal(await handler(new Request('https://app.test/'), env), null);
  assert.equal((await handler(new Request('https://app.test/api/voice/config', { method: 'POST' }), env)).status, 405);
  assert.equal((await handler(new Request('https://app.test/api/voice/missing'), env)).status, 404);
  assert.equal((await handler(new Request('https://app.test/api/voice/search'), env)).headers.get('allow'), 'POST');
});

test('verifies Spotify account first, sends only audio to Gemini, and preserves multilingual proper names', async () => {
  for (const output of [answer,
    { ...answer, transcript: 'Play Yesterday by The Beatles', language: 'en', artist: 'The Beatles', title: 'Yesterday' },
    { ...answer, transcript: '宇多田ヒカルのFirst Loveをかけて', language: 'mul', artist: '宇多田ヒカル', title: 'First Love' },
    { ...answer, transcript: 'Play Yesterday', language: 'en', artist: '', title: 'Yesterday' }]) {
    const { handler, calls } = fixture({ output });
    const response = await handler(request(), env);
    assert.equal(response.status, 200);
    const { isMusicRequest, ...expected } = output;
    assert.deepEqual(await response.json(), expected);
    assert.equal(calls[0].url, 'https://api.spotify.com/v1/me');
    assert.equal(calls[0].headers.Authorization, 'Bearer spotify-user-token');
    assert.match(calls[1].url, /models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(calls[1].headers['x-goog-api-key'], 'provider-secret');
    assert.equal(calls[1].headers.Authorization, undefined);
    assert.equal(calls[1].body.includes('spotify-user-token'), false);
    assert.equal(calls[1].body.includes('allowed-id'), false);
    const body = JSON.parse(calls[1].body);
    assert.deepEqual(body.contents[0].parts[0].inlineData, { mimeType: 'audio/webm', data: input.audio });
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
    assert.ok(body.generationConfig.responseSchema.required.includes('isMusicRequest'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('accepts stable account_id allowlist and explicitly selected model; normalizes mp4 audio', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request({ ...input, mimeType: 'audio/mp4;codecs=mp4a.40.2' }),
    { ...env, VOICE_ALLOWED_SPOTIFY_USERS: 'another, stable-account', VOICE_MODEL: 'gemini-2.5-flash' });
  assert.equal(response.status, 200);
  assert.match(calls[1].url, /gemini-2\.5-flash:generateContent$/);
  assert.equal(JSON.parse(calls[1].body).contents[0].parts[0].inlineData.mimeType, 'audio/m4a');
  assert.equal(JSON.parse(calls[1].body).generationConfig.thinkingConfig, undefined);
});

test('browser origin restrictions never substitute for Spotify authorization', async () => {
  const { handler, calls } = fixture();
  for (const headers of [{ Origin: 'https://attacker.test' }, { 'Sec-Fetch-Site': 'cross-site' }])
    assert.equal((await handler(request(input, headers), env)).status, 403);
  for (const token of ['', 'Basic token', 'Bearer token token'])
    assert.equal((await handler(request(input, { Authorization: token }), env)).status, 401);
  const missingOrigin = request(); missingOrigin.headers.delete('Origin'); missingOrigin.headers.delete('Authorization');
  assert.equal((await handler(missingOrigin, env)).status, 401);
  assert.equal(calls.length, 0);
  const unauthorized = fixture({ profile: { id: 'someone-else' } });
  assert.equal((await unauthorized.handler(request(), env)).status, 403);
  assert.equal(unauthorized.calls.length, 1);
  for (const status of [401, 403, 429, 500]) {
    const handler = createVoiceHandler({ fetcher: async () => new Response('private upstream', { status }) });
    const response = await handler(request(), env);
    assert.equal(response.status, status === 403 ? 401 : status === 500 ? 502 : status);
    assert.equal((await response.text()).includes('private upstream'), false);
  }
});

test('rejects invalid audio, noncanonical base64, unknown fields and oversized audio before provider access', async () => {
  const { handler, calls } = fixture();
  for (const body of [null, [], {}, { ...input, extra: true }, { ...input, audio: '' }, { ...input, audio: 'YQ=' },
    { ...input, audio: 'YR==' }, { ...input, audio: ' YQ==' }, { ...input, audio: 'YQ==\n' }, { ...input, audio: '____' }])
    assert.equal((await handler(request(body), env)).status, 400);
  assert.equal((await handler(request({ ...input, mimeType: 'text/plain' }), env)).status, 415);
  assert.equal((await handler(request(input, { 'Content-Type': 'text/plain' }), env)).status, 400);
  assert.equal((await handler(request({ ...input, audio: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }), env)).status, 413);
  assert.equal(calls.length, 0);
});

test('caps streamed request bodies without trusting Content-Length and cancels unread tail', async () => {
  const { handler, calls } = fixture();
  let cancelled = false;
  let sent = false;
  const stream = new ReadableStream({ pull(controller) { if (!sent) { sent = true; controller.enqueue(new Uint8Array(3 * 1024 * 1024 + 1)); } }, cancel() { cancelled = true; } });
  const response = await handler(new Request('https://app.test/api/voice/search', { method: 'POST',
    headers: request().headers, body: stream, duplex: 'half' }), env);
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 0);
});

test('nonmusic, empty and malformed model responses do not produce a playable song', async () => {
  for (const [output, status] of [[{ ...answer, isMusicRequest: false }, 422], [{ ...answer, title: '' }, 422],
    [{ ...answer, artist: null }, 502], [{ ...answer, language: 'unknown language' }, 502],
    [{ ...answer, title: 'a'.repeat(301) }, 502], [{ ...answer, title: 'bad\nname' }, 502]]) {
    const { handler } = fixture({ output });
    assert.equal((await handler(request(), env)).status, status);
  }
  for (const body of [{ candidates: [] }, { candidates: [{ finishReason: 'MAX_TOKENS' }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } }] }]) {
    const handler = createVoiceHandler({ fetcher: async url => Response.json(url.includes('spotify.com') ? { id: 'allowed-id' } : body) });
    assert.ok([422, 502].includes((await handler(request(), env)).status));
  }
});

test('sanitizes provider failure and bounds even chunked provider responses', async () => {
  for (const status of [400, 401, 429, 500]) {
    const { handler } = fixture({ providerStatus: status });
    const response = await handler(request(), env);
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.equal((await response.text()).includes('private upstream'), false);
  }
  let cancelled = false;
  const handler = createVoiceHandler({ fetcher: async url => url.includes('spotify.com') ? Response.json({ id: 'allowed-id' }) :
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } })) });
  assert.equal((await handler(request(), env)).status, 502);
  assert.equal(cancelled, true);
});

test('one active request and six requests per minute; quota resets and is tied to identity rather than bearer', async () => {
  let now = 1000;
  const { handler, calls } = fixture({ clock: () => now });
  for (let i = 0; i < 6; i++) assert.equal((await handler(request(input, { Authorization: 'Bearer token-' + i }), env)).status, 200);
  const blocked = await handler(request(), env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal(calls.filter(x => x.url.includes('googleapis')).length, 6);
  now += 60000;
  assert.equal((await handler(request(), env)).status, 200);

  let resolveProvider;
  let providerStarted;
  const started = new Promise(resolve => { providerStarted = resolve; });
  const active = createVoiceHandler({ fetcher: async url => {
    if (url.includes('spotify.com')) return Response.json({ id: 'allowed-id' });
    providerStarted();
    return new Promise(resolve => { resolveProvider = resolve; });
  } });
  const first = active(request(), env);
  await started;
  assert.equal((await active(request(), env)).status, 429);
  resolveProvider(result(answer));
  assert.equal((await first).status, 200);
});

test('times out provider headers and body, aborts request, and releases in-flight reservation', async () => {
  let providerCalls = 0;
  let aborted = false;
  const handler = createVoiceHandler({ providerTimeout: 5, fetcher: async (url, options) => {
    if (url.includes('spotify.com')) return Response.json({ id: 'allowed-id' });
    providerCalls++;
    if (providerCalls > 1) return result(answer);
    options.signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(() => {});
  } });
  assert.equal((await handler(request(), env)).status, 504);
  assert.equal(aborted, true);
  assert.equal((await handler(request(), env)).status, 200);
  let cancelled = false;
  const bodyHandler = createVoiceHandler({ providerTimeout: 5, fetcher: async url => url.includes('spotify.com') ? Response.json({ id: 'allowed-id' }) :
    new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  assert.equal((await bodyHandler(request(), env)).status, 504);
  assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort();
  const cancelledRequest = new Request(request(), { signal: controller.signal });
  assert.equal((await handler(cancelledRequest, env)).status, 499);
});
