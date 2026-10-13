// Spotify 원본 응답에서 화면에 필요한 값만 추출합니다.
export function normalizePlayer(data) {
  const track = data?.item;
  if (!track) return { status: 'empty', playing: false, canNext: false, canPrevious: false, canToggle: false, canVolume: false };
  if (track.type !== 'track') return { status: 'unsupported', playing: false, canNext: false, canPrevious: false, canToggle: false, canVolume: false };
  const blocked = data.actions?.disallows || data.actions || {};
  const restricted = Boolean(data.device?.is_restricted);
  // 볼륨 값이 누락되면 0으로 추측하지 않고 조절을 비활성화합니다.
  const volume = data.device?.volume_percent;
  const validVolume = Number.isInteger(volume) && volume >= 0 && volume <= 100;
  const images = (track.album?.images || []).filter(image => /^https:\/\/i\.scdn\.co\//.test(image.url));
  const image = [...images].sort((a, b) => a.width - b.width).find(item => item.width >= 240) || images[0];
  return {
    status: 'ready', id: track.id || track.uri, title: track.name || '제목 미제공',
    artist: (track.artists || []).map(artist => artist.name).join(', '),
    primaryArtist: track.artists?.[0]?.name || '', album: track.album?.name || '',
    image: image?.url || '', url: /^https:\/\/open\.spotify\.com\//.test(track.external_urls?.spotify) ? track.external_urls.spotify : '',
    duration: Math.max(0, Number(track.duration_ms) || 0), progress: Math.max(0, Number(data.progress_ms) || 0),
    playing: Boolean(data.is_playing), device: data.device?.name || '', deviceType: data.device?.type || '',
    deviceId: data.device?.id || null, volume: validVolume ? volume : null,
    canVolume: !restricted && data.device?.supports_volume === true && validVolume,
    canNext: !restricted && !blocked.skipping_next,
    canPrevious: !restricted && !blocked.skipping_prev,
    canToggle: !restricted && !(data.is_playing ? blocked.pausing : blocked.resuming),
  };
}

// API 응답 사이의 진행 시간을 계산하고 일시정지와 곡 끝에서는 고정합니다.
export function progressAt(player, sampledAt, now) {
  return Math.min(player.duration || 0, (player.progress || 0) + (player.playing ? Math.max(0, now - sampledAt) : 0));
}

// 세로 탐색과 탭을 곡 넘기기로 오인하지 않도록 방향·거리·시간을 확인합니다.
export function swipeAction(x, y, elapsed) {
  return elapsed <= 900 && Math.abs(x) >= 40 && Math.abs(x) > Math.abs(y) * 1.3 ? (x < 0 ? 'next' : 'previous') : null;
}

// 공급자의 LRC에서 타임스탬프를 읽고 HTML은 해석하지 않습니다.
export function parseLrc(value) {
  const lines = [];
  for (const raw of (value || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const stamp of stamps) {
      lines.push({ time: Number(stamp[1]) * 60000 + Number(stamp[2]) * 1000 + Number((stamp[3] || '').padEnd(3, '0')), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

// 가사 시작 전에는 임의의 첫 줄을 현재 가사로 표시하지 않습니다.
export function currentLine(lines, progress) {
  let found = -1;
  for (let index = 0; index < lines.length && lines[index].time <= progress; index++) found = index;
  return found;
}
