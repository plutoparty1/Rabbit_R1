// 실제 가사를 복사하지 않고 벅스의 공개 응답 구조만 모의 처리합니다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBugsTracks, getBugsLyrics } from '../server/bugs.mjs';

const track = { title: '살얼음', artist: '시올', album: '왜곡된 시선', duration: 206 };
const row = (id = '32794634', title = track.title, artist = track.artist, album = track.album) =>
  `<tr rowType="track" trackId="${id}"><td><p class="title"><a>${title}</a></p><p class="artist"><a>${artist}</a></p><a class="album">${album}</a></td></tr>`;
const detail = (duration = '03:26') => `<table><tr><th scope="row">재생 시간</th><td><time datetime="${duration}">${duration}</time></td></tr></table>`;
const mockFetch = (replies, calls = []) => async (url, options) => {
  calls.push({ url: new URL(url), options });
  assert.equal(options.headers?.Authorization, undefined);
  assert.equal(options.headers?.Cookie, undefined);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.redirect, 'manual');
  const reply = replies.shift();
  assert.ok(reply, '예상하지 않은 추가 요청입니다.');
  if (reply instanceof Error) throw reply;
  return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status || 200 });
};

test('검색 행의 제목·가수·앨범과 HTML 문자를 읽고 중복 곡을 제거합니다.', () => {
  const rows = parseBugsTracks(row('1', 'A &amp; B &#39;곡&#39;', '가수 &#x41;', '앨범 &quot;1&quot;') + row('1') + '<tr><td>광고</td></tr>');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { id: '1', title: "A & B '곡'", artists: ['가수 A'], album: '앨범 "1"' });
});

test('시올 살얼음과 같은 구조의 곡을 길이 확인 후 조회합니다.', async () => {
  const calls = [];
  const result = await getBugsLyrics(track, mockFetch([{ body: row() }, { body: detail() }, { body: { lyrics: '시험 가사 첫 줄\n시험 가사 둘째 줄', userId: '반환 금지' } }], calls));
  assert.equal(result.source, '벅스');
  assert.equal(result.syncedLyrics, null);
  assert.equal(result.plainLyrics, '시험 가사 첫 줄\n시험 가사 둘째 줄');
  assert.equal(result.sourceUrl, 'https://music.bugs.co.kr/track/32794634');
  assert.equal(result.userId, undefined);
  assert.equal(calls[0].url.searchParams.get('q'), '살얼음 시올');
  assert.equal(calls[2].url.pathname, '/player/lyrics/N/32794634');
});

test('같은 제목의 다른 가수·연주 버전·임의 주소는 조회하지 않습니다.', async () => {
  const calls = [];
  const result = await getBugsLyrics(track, mockFetch([{ body: row('1', track.title, '다른 가수') + row('2', '살얼음 (inst.)') + row('https://evil.test/') }], calls));
  assert.equal(result, null);
  assert.equal(calls.length, 1);
});

test('공식 가수 표기의 한국어·영어 별칭을 허용합니다.', async () => {
  const result = await getBugsLyrics({ ...track, title: '시험 곡', artist: 'Test Artist' },
    mockFetch([{ body: row('2', '시험 곡', '시험 가수(Test Artist)') }, { body: detail() }, { body: { lyrics: '별칭 시험 가사' } }]));
  assert.equal(result.plainLyrics, '별칭 시험 가사');
});

test('같은 앨범을 우선하고 길이가 다른 후보는 건너뜁니다.', async () => {
  const calls = [];
  const result = await getBugsLyrics(track, mockFetch([{ body: row('1', track.title, track.artist, '다른 앨범') + row('2') },
    { body: detail('04:00') }, { body: detail('03:27') }, { body: { lyrics: '일치한 가사' } }], calls));
  assert.equal(calls[1].url.pathname, '/track/2');
  assert.equal(calls[2].url.pathname, '/track/1');
  assert.equal(result.sourceUrl, 'https://music.bugs.co.kr/track/1');
});

test('시간 정보가 없거나 2초 넘게 다른 후보를 사용하지 않습니다.', async () => {
  for (const body of [detail('03:29'), '<html>시간 정보 없음</html>']) {
    const calls = [];
    assert.equal(await getBugsLyrics(track, mockFetch([{ body: row() }, { body }], calls)), null);
    assert.equal(calls.length, 2);
  }
});

test('빈 가사는 없음으로 처리합니다.', async () => {
  assert.equal(await getBugsLyrics(track, mockFetch([{ body: row() }, { body: detail() }, { body: { lyrics: ' \n ' } }])), null);
});

test('외부 서버에 클라이언트 이름과 HTML·JSON 응답 형식을 명시합니다.', async () => {
  const replies = mockFetch([{ body: row() }, { body: detail() }, { body: { lyrics: '헤더 확인용 가사' } }]);
  const fetcher = (url, options) => options.headers?.['User-Agent'] && options.headers?.Accept?.includes('application/json')
    ? replies(url, options) : Promise.resolve(new Response('{}', { status: 500 }));
  assert.equal((await getBugsLyrics(track, fetcher)).plainLyrics, '헤더 확인용 가사');
});

test('배포 서버에서 지원하는 방식으로 주소 변경 응답을 거부합니다.', async () => {
  const calls = [];
  await assert.rejects(() => getBugsLyrics(track, mockFetch([{ status: 302, body: '' }], calls)), /벅스 조회/);
  assert.equal(calls.length, 1);
});

test('손상된 가사 응답·통신 오류·서버 오류는 장애로 구분합니다.', async () => {
  for (const reply of [{ body: { lyrics: {} } }, { status: 503, body: {} }, new TypeError('통신 오류')]) {
    await assert.rejects(() => getBugsLyrics(track, mockFetch([{ body: row() }, { body: detail() }, reply])));
  }
});

test('검색 결과 확인은 중복 제거 후 최대 세 후보로 제한합니다.', async () => {
  const calls = [];
  const rows = [1, 2, 3, 4].map(id => row(String(id))).join('');
  assert.equal(await getBugsLyrics(track, mockFetch([{ body: rows }, ...Array.from({ length: 3 }, () => ({ body: detail('04:00') }))], calls)), null);
  assert.equal(calls.length, 4);
});
