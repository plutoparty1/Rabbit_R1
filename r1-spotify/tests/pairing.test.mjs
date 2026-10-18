import test from 'node:test';
import assert from 'node:assert/strict';
import { pairing } from '../server/pairing.mjs';
import { PairingStore } from './pairing-store.mjs';

const origin = 'https://app.test';
const id = 'a'.repeat(32);
function request(action, input, overrides = {}) {
  return new Request(origin + '/api/pair/' + action, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...overrides }, body: JSON.stringify(input) });
}
async function begin(env) { const response = await pairing(request('start', {}), env); assert.equal(response.status, 200); return response.json(); }

test('two devices transfer only a Client ID; receiver proof, acknowledgement and no-store', async () => {
  const env = { PAIRING: new PairingStore() }, session = await begin(env);
  assert.match(session.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.match(session.secret, /^[a-f0-9]{64}$/);
  const { code, secret } = session;
  assert.equal((await pairing(request('poll', { code, secret: 'b'.repeat(64) }), env)).status, 403);
  assert.deepEqual(await (await pairing(request('poll', { code, secret }), env)).json(), { state: 'waiting' });
  const sent = await pairing(request('submit', { code, clientId: id }), env);
  assert.equal(sent.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await sent.json(), { sent: true, suffix: 'aaaaaaaa' });
  assert.equal((await pairing(request('submit', { code, clientId: 'b'.repeat(32) }), env)).status, 409);
  for (let i = 0; i < 2; i++) assert.deepEqual(await (await pairing(request('poll', { code, secret }), env)).json(), { state: 'ready', clientId: id });
  assert.equal((await pairing(request('cancel', { code, secret }), env)).status, 200);
  assert.equal((await pairing(request('poll', { code, secret }), env)).status, 410);
});

test('concurrent phone submissions cannot overwrite the first accepted ID', async () => {
  const env = { PAIRING: new PairingStore() }, { code, secret } = await begin(env);
  const responses = await Promise.all(['a', 'b'].map(char => pairing(request('submit', { code, clientId: char.repeat(32) }), env)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? 'a' : 'b';
  assert.equal((await (await pairing(request('poll', { code, secret }), env)).json()).clientId, winner.repeat(32));
});

test('expiry blocks all reads and new sessions prune abandoned records', async t => {
  const env = { PAIRING: new PairingStore() }, session = await begin(env);
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 600001);
  assert.equal((await pairing(request('submit', { code: session.code, clientId: id }), env)).status, 410);
  assert.ok(!env.PAIRING.records.has('pairing/v1/session/' + session.code));
  const other = await begin(env);
  assert.ok(other.code);
  assert.ok([...env.PAIRING.records.entries()].filter(([key]) => key.startsWith('pairing/v1/')).every(([, x]) => Number(x.customMetadata.expiresAt) > Date.now()));
});

test('rejects cross-site submissions, oversized bodies, token fields and invalid IDs', async () => {
  const env = { PAIRING: new PairingStore() }, { code } = await begin(env);
  assert.equal((await pairing(request('submit', { code, clientId: id }, { Origin: 'https://evil.test' }), env)).status, 403);
  assert.equal((await pairing(request('submit', { code, clientId: id, access_token: 'secret' }), env)).status, 400);
  assert.equal((await pairing(request('submit', { code, clientId: 'secret' }), env)).status, 400);
  assert.equal((await pairing(request('submit', { code, clientId: 'x'.repeat(1100) }), env)).status, 413);
  assert.equal((await pairing(request('poll', { code }), env)).status, 403);
  assert.equal((await pairing(request('start', {}), {})).status, 503);
});

test('bounds session creation and guessing per IP without persisting raw IPs', async () => {
  const env = { PAIRING: new PairingStore() };
  for (let i = 0; i < 8; i++) await begin(env);
  assert.equal((await pairing(request('start', {}), env)).status, 429);
  for (let i = 0; i < 30; i++) assert.equal((await pairing(request('submit', { code: 'ZZZZ9999', clientId: id }), env)).status, 410);
  assert.equal((await pairing(request('submit', { code: 'ZZZZ9999', clientId: id }), env)).status, 429);
  assert.ok([...env.PAIRING.records.keys()].every(key => !key.includes('local-preview')));
});
