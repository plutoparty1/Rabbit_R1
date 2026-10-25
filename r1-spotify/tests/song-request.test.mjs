import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSongRequest, rankSongCandidates } from '../dist/song-request.mjs';

test('explicit Korean and English song commands parse locally without changing names', () => {
  assert.deepEqual(parseSongRequest('아이유의 밤편지 틀어줘.'), { artist: '아이유', title: '밤편지', requiresConfirmation: false });
  assert.deepEqual(parseSongRequest('김의철의 너의 의미를 재생해 주세요'), { artist: '김의철', title: '너의 의미', requiresConfirmation: false });
  assert.deepEqual(parseSongRequest('Please play Yesterday by the Beatles, please.'), { artist: 'the Beatles', title: 'Yesterday', requiresConfirmation: false });
  assert.deepEqual(parseSongRequest('Queen의 Somebody to Love 들려줘'), { artist: 'Queen', title: 'Somebody to Love', requiresConfirmation: false });
});

test('garbled titles remain unchanged and require a user choice', () => {
  assert.deepEqual(parseSongRequest('IU의 편벤지트로저'), { artist: 'IU', title: '편벤지트로저', requiresConfirmation: true });
  assert.deepEqual(parseSongRequest('IU의 반편지 들어줘'), { artist: 'IU', title: '반편지', requiresConfirmation: true });
  assert.deepEqual(parseSongRequest('태연의 사계'), { artist: '태연', title: '사계', requiresConfirmation: true });
});

test('unsupported or malformed requests fall back to the existing parser', () => {
  for (const text of [null, {}, '', '틀어줘', '무슨 노래 들을까', 'play by', 'x'.repeat(501), '아이유의 밤편지\n틀어줘']) {
    assert.equal(parseSongRequest(text), null);
  }
});

test('jamo similarity ranks actual catalog names without modifying or collapsing versions', () => {
  const tracks = ['팔레트', '밤편지 (Live)', '밤편지', '좋은 날'].map(name => ({ name }));
  assert.equal(rankSongCandidates(tracks, { title: '반편지' })[0].name, '밤편지');
  assert.equal(rankSongCandidates(tracks, { title: '밤편지 (Live)' })[0].name, '밤편지 (Live)');
  assert.equal(rankSongCandidates(tracks, { title: '편벤지트로저' })[0].name, '밤편지');
  assert.deepEqual(tracks.map(track => track.name), ['팔레트', '밤편지 (Live)', '밤편지', '좋은 날']);
  assert.ok(rankSongCandidates(tracks, { title: '반편지' }).every(track => tracks.includes(track)));
});
