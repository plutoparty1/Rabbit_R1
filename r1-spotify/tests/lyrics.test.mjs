// 외부 가사 조회를 모의 처리하여 실제 계정이나 가사 서비스에 요청하지 않습니다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getLyrics } from '../dist/spotify.mjs';

const player = { title: '시험 곡', primaryArtist: '시험 가수', album: '새 앨범', duration: 180000 };
const record = { trackName: player.title, artistName: player.primaryArtist, albumName: '기존 앨범', duration: 180, plainLyrics: '일반 가사', syncedLyrics: null };
const missing = { status: 404, body: {} };

// 요청 순서·안전한 인코딩·인증 정보 미전송을 함께 확인합니다.
function mockRequests(t, replies, bugsReply = missing) {
  const calls = [];
  // 기존 제공처의 회귀 검사와 벅스 요청을 각각 기록합니다.
  calls.bugs = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const call = { url: new URL(url, 'https://app.test'), options };
    const bugs = call.url.pathname === '/api/lyrics/bugs';
    (bugs ? calls.bugs : calls).push(call);
    const reply = bugs ? bugsReply : replies[calls.length - 1];
    assert.ok(reply, '예상하지 않은 추가 요청입니다.');
    assert.equal(options.headers?.Authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status || 200 });
  });
  return calls;
}

test('벅스에 없으면 정확한 LRCLIB 가사를 표시하고 추가 조회하지 않습니다.', async t => {
  const calls = mockRequests(t, [{ body: record }]);
  const result = await getLyrics(player);
  assert.equal(result.plainLyrics, record.plainLyrics);
  assert.equal(result.source, 'LRCLIB');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/api/get');
  assert.equal(calls[0].url.searchParams.get('album_name'), player.album);
});

test('벅스 가사를 먼저 사용하고 외부 제공처는 호출하지 않습니다.', async t => {
  const calls = mockRequests(t, [], { body: { plainLyrics: '벅스 시험 가사', syncedLyrics: null, source: '벅스' } });
  const result = await getLyrics(player);
  assert.equal(result.source, '벅스');
  assert.equal(result.plainLyrics, '벅스 시험 가사');
  assert.equal(calls.length, 0);
  assert.equal(calls.bugs.length, 1);
  assert.equal(calls.bugs[0].url.origin, 'https://app.test');
  assert.equal(calls.bugs[0].url.searchParams.get('title'), player.title);
  assert.equal(calls.bugs[0].url.searchParams.get('artist'), player.primaryArtist);
  assert.equal(calls.bugs[0].url.searchParams.get('album'), player.album);
  assert.equal(calls.bugs[0].url.searchParams.get('duration'), '180');
});

test('벅스 조회 장애 시 기존 제공처에서 복구합니다.', async t => {
  const calls = mockRequests(t, [{ body: record }], { status: 502, body: {} });
  assert.equal((await getLyrics(player)).source, 'LRCLIB');
  assert.equal(calls.bugs.length, 1);
});

test('벅스 장애가 있으면 나머지 제공처의 404로 오류를 숨기지 않습니다.', async t => {
  mockRequests(t, [missing, { body: [] }, missing], new TypeError('벅스 통신 오류'));
  await assert.rejects(() => getLyrics(player), /가사를 불러오지 못했습니다/);
});

test('앨범명 차이로 조회가 실패하면 같은 곡을 재검색합니다.', async t => {
  const calls = mockRequests(t, [missing, { body: [{ ...record, trackName: '  시험   곡 ', artistName: '시험 가수 ', duration: 181.5 }] }]);
  const result = await getLyrics(player);
  assert.equal(result.plainLyrics, '일반 가사');
  assert.equal(result.source, 'LRCLIB');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.pathname, '/api/search');
  assert.equal(calls[1].url.searchParams.has('album_name'), false);
  assert.equal(calls[1].url.searchParams.get('track_name'), player.title);
  assert.equal(calls[1].url.searchParams.get('artist_name'), player.primaryArtist);
});

test('일치한 후보 중 시간 가사를 우선하고 같은 앨범을 선택합니다.', async t => {
  mockRequests(t, [missing, { body: [record, { ...record, syncedLyrics: '[00:01.00]다른 앨범' },
    { ...record, albumName: player.album, syncedLyrics: '[00:01.00]같은 앨범' }] }]);
  assert.equal((await getLyrics(player)).syncedLyrics, '[00:01.00]같은 앨범');
});

test('다른 가수·제목·버전·길이와 손상된 후보는 표시하지 않습니다.', async t => {
  const candidates = [null, { ...record, artistName: '다른 가수' }, { ...record, trackName: '다른 곡' },
    { ...record, trackName: '시험 곡 (Live)' }, { ...record, duration: 183 }, { ...record, duration: null },
    { ...record, duration: '180' }, { ...record, syncedLyrics: {}, plainLyrics: ['손상'] }];
  const calls = mockRequests(t, [missing, { body: candidates }, { body: { lyrics: '대체 가사' } }]);
  const result = await getLyrics(player);
  assert.equal(result.plainLyrics, '대체 가사');
  assert.equal(result.source, 'lyrics.ovh');
  assert.equal(result.syncedLyrics, null);
  assert.equal(calls[2].url.origin, 'https://api.lyrics.ovh');
});

test('빈 가사도 재검색과 대체 제공처를 사용합니다.', async t => {
  mockRequests(t, [{ body: { plainLyrics: '  ', syncedLyrics: null } }, { body: [] }, { body: { lyrics: '복구된 가사' } }]);
  assert.equal((await getLyrics(player)).plainLyrics, '복구된 가사');
});

test('확인된 연주곡은 대체 제공처에 요청하지 않습니다.', async t => {
  const calls = mockRequests(t, [{ body: { instrumental: true } }]);
  assert.equal((await getLyrics(player)).instrumental, true);
  assert.equal(calls.length, 1);
});

test('제목과 가수의 슬래시·물음표·한글을 안전하게 전달합니다.', async t => {
  const track = { ...player, title: '곡 / 제목?', primaryArtist: '가수 & 이름' };
  const calls = mockRequests(t, [missing, { body: [] }, { body: { lyrics: '가사' } }]);
  await getLyrics(track);
  const parts = calls[2].url.pathname.split('/');
  assert.equal(decodeURIComponent(parts[2]), track.primaryArtist);
  assert.equal(decodeURIComponent(parts[3]), track.title);
  assert.equal(calls[2].url.search, '');
});

for (const reply of [{ status: 503, body: {} }, new TypeError('통신 오류')]) {
  test(`LRCLIB 장애에도 다른 제공처에서 복구합니다: ${reply.status || 'network'}`, async t => {
    const calls = mockRequests(t, [reply, { body: { lyrics: '대체 가사' } }]);
    assert.equal((await getLyrics(player)).source, 'lyrics.ovh');
    assert.equal(calls[1].url.host, 'api.lyrics.ovh');
  });
}

test('재검색 장애에도 대체 조회를 계속합니다.', async t => {
  mockRequests(t, [missing, { status: 503, body: {} }, { body: { lyrics: '대체 가사' } }]);
  assert.equal((await getLyrics(player)).plainLyrics, '대체 가사');
});

test('모든 제공처에 가사가 없으면 없음으로 반환합니다.', async t => {
  mockRequests(t, [missing, { body: [] }, missing]);
  assert.equal(await getLyrics(player), null);
});

for (const reply of [{ status: 503, body: {} }, new TypeError('통신 오류'), { body: { lyrics: {} } }]) {
  test(`대체 조회 장애·손상 응답은 가사 없음과 구분합니다: ${reply.status || reply.name || 'payload'}`, async t => {
    mockRequests(t, [missing, { body: [] }, reply]);
    await assert.rejects(() => getLyrics(player), /가사를 불러오지 못했습니다/);
  });
}

test('앞선 조회가 실패하면 마지막 404로 장애를 숨기지 않습니다.', async t => {
  mockRequests(t, [{ status: 503, body: {} }, missing]);
  await assert.rejects(() => getLyrics(player), /가사를 불러오지 못했습니다/);
});

test('대체 제공처의 빈 문자열은 가사 없음으로 반환합니다.', async t => {
  mockRequests(t, [missing, { body: [] }, { body: { lyrics: ' \n ' } }]);
  assert.equal(await getLyrics(player), null);
});

test('브라우저 보안 설정이 대체 제공처의 연결을 허용합니다.', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const policy = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(policy.split(';').find(value => value.trim().startsWith('connect-src')), /https:\/\/api\.lyrics\.ovh/);
});
