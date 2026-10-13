// 브라우저나 r1 장치 없이도 취소와 버튼 해제 경합을 재현합니다.
import assert from 'node:assert/strict';
import { Ptt } from '../creation/ptt.mjs';

function setup() {
  const events = [], sessions = [];
  const ptt = new Ptt({
    open: async callbacks => {
      const session = { callbacks, stopCount: 0, abortCount: 0,
        stop() { this.stopCount++; }, abort() { this.abortCount++; } };
      sessions.push(session);
      return session;
    },
    report: e => events.push(e), maxMs: 10000, finalMs: 10000,
  });
  return { ptt, sessions, events };
}

// 최종 결과는 버튼을 놓고 인식 종료가 확인된 후 한 번만 표시합니다.
{
  const { ptt, sessions, events } = setup();
  await ptt.start(); await ptt.start();
  sessions[0].callbacks.final('한국어 명령입니다.');
  assert.equal(events.filter(e => e.kind === 'final').length, 0);
  ptt.release(); ptt.release();
  assert.equal(sessions[0].stopCount, 1);
  sessions[0].callbacks.end(); sessions[0].callbacks.end();
  assert.equal(events.filter(e => e.kind === 'final').length, 1);
  assert.equal(events.find(e => e.kind === 'final').text, '한국어 명령입니다.');
}

// 취소, 인식 오류, 무음에서는 최종 문장 이벤트를 만들지 않습니다.
for (const reason of ['cancel', 'error', 'silence']) {
  const { ptt, sessions, events } = setup();
  await ptt.start();
  if (reason === 'cancel') ptt.cancel();
  if (reason === 'error') sessions[0].callbacks.error('오류');
  ptt.release(); sessions[0].callbacks.end();
  assert.equal(events.filter(e => e.kind === 'final').length, 0);
}

// 권한 요청 도중 버튼을 놓거나 취소해도 나중에 열린 마이크를 즉시 닫습니다.
for (const cancel of [false, true]) {
  let resolve, stopped = 0, aborted = 0;
  const ptt = new Ptt({ open: () => new Promise(r => { resolve = r; }), report: () => {} });
  const opening = ptt.start();
  cancel ? ptt.cancel() : ptt.release();
  resolve({ stop() { stopped++; }, abort() { aborted++; } });
  await opening;
  assert.equal(stopped + aborted, 1);
  ptt.cancel();
}

// 취소된 이전 녹음의 늦은 결과는 다음 녹음에 섞지 않습니다.
{
  const { ptt, sessions, events } = setup();
  await ptt.start(); ptt.cancel(); await ptt.start();
  sessions[0].callbacks.final('이전 결과'); sessions[0].callbacks.end();
  ptt.release(); sessions[1].callbacks.final('새 결과'); sessions[1].callbacks.end();
  assert.deepEqual(events.filter(e => e.kind === 'final').map(e => e.text), ['새 결과']);
}
// 녹음 시간과 최종 인식 대기 시간이 초과되면 마이크를 취소합니다.
for (const release of [false, true]) {
  const { ptt, sessions, events } = setup();
  ptt.maxMs = ptt.finalMs = 5;
  await ptt.start();
  if (release) ptt.release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sessions[0].abortCount, 1);
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.equal(ptt.current, null);
}
console.log('PTT 시나리오 9개의 자동 검증이 통과하였습니다.');
