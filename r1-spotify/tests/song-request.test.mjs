import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSongRequest, createSongSearchRequest, rankSongCandidates } from '../dist/song-request.mjs';

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

test('unstructured requests search recognized words without guessing an artist or correcting a title', () => {
  for (const [heard, query] of [
    ['아이유 밤편지 틀어줘.', '아이유 밤편지'],
    ['아이유 밤편지를 재생해 주세요', '아이유 밤편지'],
    ['Please play Yesterday, please.', 'Yesterday'],
    ['夜に駆けるを再生してください', '夜に駆ける'],
    ['宇多田ヒカル First Loveをかけて', '宇多田ヒカル First Love'],
    ['IU 편벤지트로저', 'IU 편벤지트로저'],
    ['Replay by SHINee', 'Replay by SHINee'],
    ['The Play Song', 'The Play Song'],
  ]) {
    assert.deepEqual(createSongSearchRequest(heard), { title: query, artist: '', query, requiresConfirmation: true });
  }
});

test('empty commands and malformed search text never become catalog requests', () => {
  for (const text of [null, {}, '', '   ', '!!!', '틀어줘', '재생해 주세요', 'please play', '再生して',
    'x'.repeat(301), 'x'.repeat(501), 'artist\nsong', 'song\u0000']) {
    assert.equal(createSongSearchRequest(text), null, String(text));
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
