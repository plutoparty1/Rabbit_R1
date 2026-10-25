import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenWakeLock } from '../dist/screen-wake.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function makeSentinel() {
  const lock = new EventTarget();
  lock.released = false; lock.releases = 0;
  lock.release = async () => { lock.releases++; lock.released = true; lock.dispatchEvent(new Event('release')); };
  return lock;
}
function fixture() {
  const f = { visible: true, calls: [], events: [], requests: [] };
  f.controller = createScreenWakeLock({
    wakeLock: { request(type) { f.calls.push(type); const pending = deferred(); f.requests.push(pending); return pending.promise; } },
    isVisible: () => f.visible,
    onChange: status => f.events.push(status),
  });
  return f;
}

test('screen wake lock is lazy, joins repeated opens, and releases on close', async () => {
  const f = fixture(), lock = makeSentinel();
  assert.equal(f.controller.status, 'idle'); assert.deepEqual(f.calls, []);
  const first = f.controller.setActive(true), joined = f.controller.setActive(true);
  assert.equal(first, joined); assert.deepEqual(f.calls, ['screen']);
  f.requests[0].resolve(lock); await first;
  assert.equal(f.controller.status, 'active');
  await f.controller.setActive(true); assert.equal(f.calls.length, 1);
  await f.controller.setActive(false); await f.controller.setActive(false);
  assert.equal(lock.releases, 1); assert.equal(f.controller.status, 'idle');
  assert.deepEqual(f.events, ['requesting', 'active', 'idle']);
});

test('unsupported and rejected requests are honest, quiet, and never retry in a loop', async () => {
  const unsupported = createScreenWakeLock({ wakeLock: null });
  assert.equal(await unsupported.setActive(true), 'unsupported');
  await unsupported.setActive(false); assert.equal(unsupported.status, 'idle');
  const f = fixture(), opening = f.controller.setActive(true);
  f.requests[0].reject(new Error('provider details must not be displayed')); await opening;
  assert.equal(f.controller.status, 'denied');
  await f.controller.setActive(true); assert.equal(f.calls.length, 1);
  await f.controller.setActive(false);
  const next = f.controller.setActive(true); f.requests[1].resolve(makeSentinel()); await next;
  assert.equal(f.controller.status, 'active'); assert.equal(f.calls.length, 2);
});

test('closing while acquisition is pending releases the late lock without restoring active state', async () => {
  const f = fixture(), lock = makeSentinel(), opening = f.controller.setActive(true);
  await f.controller.setActive(false); f.requests[0].resolve(lock); await opening;
  assert.equal(lock.releases, 1); assert.equal(f.controller.status, 'idle');
  assert.ok(!f.events.includes('active'));
});

test('an old pending request cannot replace or release the lock for a reopened panel', async () => {
  const f = fixture(), first = f.controller.setActive(true);
  await f.controller.setActive(false);
  const second = f.controller.setActive(true), oldLock = makeSentinel(), newLock = makeSentinel();
  f.requests[1].resolve(newLock); await second;
  f.requests[0].resolve(oldLock); await first;
  assert.equal(oldLock.releases, 1); assert.equal(newLock.releases, 0);
  assert.equal(f.controller.status, 'active');
  await f.controller.setActive(false); assert.equal(newLock.releases, 1);
});

test('hidden documents do not acquire and a visibility change discards a pending grant', async () => {
  const f = fixture(); f.visible = false;
  await f.controller.setActive(true); assert.equal(f.calls.length, 0);
  assert.equal(f.controller.status, 'released');
  await f.controller.setActive(false); f.visible = true;
  const opening = f.controller.setActive(true), lock = makeSentinel();
  f.visible = false; f.requests[0].resolve(lock); await opening;
  assert.equal(lock.releases, 1); assert.equal(f.controller.status, 'released');
});

test('system release is reported and does not trigger an automatic acquisition loop', async () => {
  const f = fixture(), lock = makeSentinel(), opening = f.controller.setActive(true);
  f.requests[0].resolve(lock); await opening; await lock.release();
  assert.equal(f.controller.status, 'released');
  await f.controller.setActive(true); assert.equal(f.calls.length, 1);
  await f.controller.setActive(false); assert.equal(f.controller.status, 'idle');
});

test('a rejected stale request cannot overwrite the newly acquired status', async () => {
  const f = fixture(), first = f.controller.setActive(true);
  await f.controller.setActive(false);
  const second = f.controller.setActive(true); f.requests[1].resolve(makeSentinel()); await second;
  f.requests[0].reject(new Error('stale request')); await first;
  assert.equal(f.controller.status, 'active');
});
