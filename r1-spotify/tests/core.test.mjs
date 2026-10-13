// 실제 Spotify 호출 없이 표시 정보와 제스처·시간 계산의 경계를 검증합니다.
import assert from 'node:assert/strict';
import { normalizePlayer, progressAt, swipeAction, parseLrc, currentLine } from '../dist/core.mjs';

const raw = {
  is_playing: true, progress_ms: 1500,
  device: { id: 'test-device', is_restricted: false, name: '테스트 기기', supports_volume: true, volume_percent: 50 },
  actions: { disallows: { skipping_prev: true } },
  item: { type: 'track', id: 'test-track', name: '테스트 곡', duration_ms: 60000,
    artists: [{ name: '가수 하나' }, { name: '가수 둘' }],
    external_urls: { spotify: 'https://open.spotify.com/track/test-track' },
    album: { name: '테스트 앨범', images: [
      { url: 'https://i.scdn.co/image/large', width: 640 },
      { url: 'https://i.scdn.co/image/medium', width: 300 },
      { url: 'https://i.scdn.co/image/small', width: 64 }] } },
};
const player = normalizePlayer(raw);
assert.equal(player.title, '테스트 곡');
assert.equal(player.artist, '가수 하나, 가수 둘');
assert.equal(player.album, '테스트 앨범');
assert.equal(player.image, 'https://i.scdn.co/image/medium');
assert.equal(player.canPrevious, false);
assert.equal(player.canNext, true);
// 볼륨 정보가 없거나 기기에서 지원하지 않으면 임의의 볼륨을 적용하지 않습니다.
assert.equal(player.deviceId, 'test-device');
assert.equal(player.volume, 50);
assert.equal(player.canVolume, true);
for (const volume of [0, 100]) assert.equal(normalizePlayer({ ...raw, device: { ...raw.device, volume_percent: volume } }).canVolume, true);
for (const volume of [null, undefined, -1, 101, NaN, '50', 50.5]) assert.equal(normalizePlayer({ ...raw, device: { ...raw.device, volume_percent: volume } }).canVolume, false);
assert.equal(normalizePlayer({ ...raw, device: { ...raw.device, supports_volume: false } }).canVolume, false);
assert.equal(normalizePlayer({ ...raw, device: { ...raw.device, is_restricted: true } }).canVolume, false);
assert.equal(normalizePlayer(null).canVolume, false);
assert.equal(normalizePlayer(null).status, 'empty');
assert.equal(normalizePlayer({ item: { type: 'episode' } }).status, 'unsupported');
assert.equal(normalizePlayer({ ...raw, device: { is_restricted: true } }).canToggle, false);
assert.equal(normalizePlayer({ ...raw, actions: { skipping_next: true } }).canNext, false);
assert.equal(progressAt(player, 100, 600), 2000);
assert.equal(progressAt({ ...player, playing: false }, 100, 600), 1500);
assert.equal(progressAt(player, 100, 100000), 60000);
assert.equal(progressAt(player, 100, 0), 1500);
assert.equal(swipeAction(-65, 10, 200), 'next');
assert.equal(swipeAction(65, 10, 200), 'previous');
for (const gesture of [[10, 0, 200], [65, 70, 200], [80, 0, 2000]]) {
  assert.equal(swipeAction(...gesture), null);
}
// 한 줄의 여러 타임스탬프, 소수 초, 메타데이터와 가사 시작 전 상태를 확인합니다.
const lines = parseLrc('[ar:시험]\n[00:01.50]첫 줄\n[00:04.000][00:06.25]반복 줄\n잘못된 줄');
assert.deepEqual(lines.map(line => line.time), [1500, 4000, 6250]);
assert.equal(currentLine(lines, 1499), -1);
assert.equal(currentLine(lines, 1500), 0);
assert.equal(currentLine(lines, 6000), 1);
assert.equal(currentLine([], 5000), -1);
console.log('플레이어 정보·재생 시간·스와이프 검사 통과');
