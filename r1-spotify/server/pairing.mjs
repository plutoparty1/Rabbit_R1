// This relay accepts public Client IDs only. Spotify credentials never pass through it.
const TTL = 10 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const SECRET = /^[a-f0-9]{64}$/;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200) => Response.json(body, { status, headers });
const random = n => crypto.getRandomValues(new Uint8Array(n));
const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
const hash = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const keyFor = code => 'pairing/v1/session/' + code;

// Atomic R2 conditions prevent concurrent submissions from overwriting an accepted ID.
async function limited(bucket, ip, action, now) {
  const key = 'pairing/v1/rate/' + await hash(ip) + '/' + action;
  const limit = { start: 8, submit: 30, poll: 600, cancel: 60 }[action];
  for (let i = 0; i < 4; i++) {
    const object = await bucket.get(key);
    const previous = object ? await object.json() : null;
    const entry = previous?.expiresAt > now ? previous : { count: 0, expiresAt: now + TTL };
    if (entry.count >= limit) return false;
    const saved = await bucket.put(key, JSON.stringify({ ...entry, count: entry.count + 1 }), {
      onlyIf: object ? { etagMatches: object.etag } : new Headers({ 'If-None-Match': '*' }),
      customMetadata: { expiresAt: String(entry.expiresAt) },
    });
    if (saved) return true;
  }
  return false;
}

// Logical expiry is immediate. Abandoned records are physically pruned on new sessions.
async function prune(bucket, now) {
  // Keep each call bounded and advance across pages so active records cannot hide stale ones.
  const cursorKey = 'pairing/prune-cursor';
  const cursorObject = await bucket.get(cursorKey);
  const previous = cursorObject ? await cursorObject.json() : {};
  const options = { prefix: 'pairing/v1/', limit: 100, include: ['customMetadata'] };
  if (previous.cursor) options.cursor = previous.cursor;
  const objects = await bucket.list(options);
  const expired = objects.objects.filter(x => Number(x.customMetadata?.expiresAt) <= now).map(x => x.key);
  if (expired.length) await bucket.delete(expired);
  await bucket.put(cursorKey, JSON.stringify({ cursor: objects.truncated ? objects.cursor : null }));
}

export async function pairing(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/pair/')) return null;
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'origin' }, 403);
  const bucket = env.PAIRING;
  if (!bucket) return json({ error: 'unavailable' }, 503);
  const action = url.pathname.slice('/api/pair/'.length);
  if (!['start', 'submit', 'poll', 'cancel'].includes(action)) return json({ error: 'not_found' }, 404);
  // Cap streamed bodies too; Content-Length alone is insufficient.
  let input;
  try {
    let size = 0; const chunks = [];
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'input' }, 400);
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024) { await reader.cancel(); return json({ error: 'input' }, 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    input = JSON.parse(new TextDecoder().decode(bytes));
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'input' }, 400);
  } catch { return json({ error: 'input' }, 400); }
  const now = Date.now();
  try {
    if (!await limited(bucket, request.headers.get('CF-Connecting-IP') || 'local-preview', action, now)) return json({ error: 'rate' }, 429);
    if (action === 'start') {
      if (Object.keys(input).length) return json({ error: 'input' }, 400);
      await prune(bucket, now);
      for (let i = 0; i < 4; i++) {
        const code = [...random(8)].map(x => ALPHABET[x % ALPHABET.length]).join('');
        const secret = hex(random(32)), expiresAt = now + TTL;
        const object = await bucket.put(keyFor(code), JSON.stringify({ secretHash: await hash(secret), expiresAt, clientId: null }), {
          onlyIf: new Headers({ 'If-None-Match': '*' }), customMetadata: { expiresAt: String(expiresAt) },
        });
        if (object) return json({ code, secret, expiresAt });
      }
      return json({ error: 'retry' }, 503);
    }
    const code = typeof input.code === 'string' ? input.code.replace(/[-\s]/g, '').toUpperCase() : '';
    if (!CODE.test(code)) return json({ error: 'input' }, 400);
    const object = await bucket.get(keyFor(code));
    if (!object) return json({ error: 'expired' }, 410);
    const entry = await object.json();
    if (entry.expiresAt <= now) { await bucket.delete(keyFor(code)); return json({ error: 'expired' }, 410); }
    if (action === 'submit') {
      if (Object.keys(input).some(k => !['code', 'clientId'].includes(k)) || typeof input.clientId !== 'string' || !/^[a-f\d]{32}$/i.test(input.clientId)) return json({ error: 'client_id' }, 400);
      if (entry.clientId) return json({ error: 'used' }, 409);
      const updated = await bucket.put(keyFor(code), JSON.stringify({ ...entry, clientId: input.clientId.toLowerCase() }), {
        onlyIf: { etagMatches: object.etag }, customMetadata: { expiresAt: String(entry.expiresAt) },
      });
      return updated ? json({ sent: true, suffix: input.clientId.slice(-8).toLowerCase() }) : json({ error: 'used' }, 409);
    }
    if (Object.keys(input).some(k => !['code', 'secret'].includes(k)) || !SECRET.test(input.secret || '') || await hash(input.secret) !== entry.secretHash) return json({ error: 'receiver' }, 403);
    if (action === 'cancel') { await bucket.delete(keyFor(code)); return json({ cancelled: true }); }
    // Retain until explicit confirmation/cancel so a lost poll response can be retried.
    return json(entry.clientId ? { state: 'ready', clientId: entry.clientId } : { state: 'waiting' });
  } catch {
    // Never include IDs, short codes, tokens or storage errors in logs/responses.
    return json({ error: 'unavailable' }, 503);
  }
}
