// 같은 출처의 조회 경로와 기존 정적 화면이 함께 작동하는지 검증합니다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';

test('기존 화면과 모듈을 원문 그대로 제공합니다.', async () => {
  for (const name of ['index.html', 'app.mjs', 'core.mjs', 'spotify.mjs', 'style.css']) {
    const response = await worker.fetch(new Request('https://app.test/' + name + '?v=test'));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await readFile(new URL('../dist/' + name, import.meta.url), 'utf8'));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal((await worker.fetch(new Request('https://app.test/'))).status, 200);
  const head = await worker.fetch(new Request('https://app.test/app.mjs', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('조회 입력·지원 메서드·알 수 없는 경로를 검사합니다.', async () => {
  for (const query of ['', '?title=곡&artist=가수&duration=-1', '?title=곡&artist=가수&duration=NaN', '?title=' + 'a'.repeat(301) + '&artist=가수&duration=180']) {
    assert.equal((await worker.fetch(new Request('https://app.test/api/lyrics/bugs' + query))).status, 400);
  }
  assert.equal((await worker.fetch(new Request('https://app.test/api/lyrics/bugs', { method: 'POST' }))).status, 405);
  assert.equal((await worker.fetch(new Request('https://app.test/missing'))).status, 404);
});

test('서버 장애는 오류 상태로 반환하며 내부 오류와 인증값을 노출하지 않습니다.', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('내부 비밀 값'); });
  const response = await worker.fetch(new Request('https://app.test/api/lyrics/bugs?title=곡&artist=가수&duration=180'));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).message.includes('내부 비밀'), false);
});
