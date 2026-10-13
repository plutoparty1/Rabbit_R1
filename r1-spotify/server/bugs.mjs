// 벅스 공개 검색 결과의 곡 정보만 읽으며 HTML이나 등록자 정보를 앱에 전달하지 않습니다.
const name = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function htmlText(value = '') {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()];
      const code = parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    }).replace(/\s+/g, ' ').trim();
}

// 곡 ID는 숫자만 허용하며 통합 검색에 반복되는 행은 한 번만 사용합니다.
export function parseBugsTracks(html) {
  const tracks = [], seen = new Set();
  for (const row of html.matchAll(/<tr\b[^>]*\btrackId\s*=\s*["'](\d{1,15})["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const title = htmlText(row[2].match(/<p\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const artistBlock = row[2].match(/<p\b[^>]*class=["'][^"']*\bartist\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '';
    const artists = [...artistBlock.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(match => htmlText(match[1])).filter(Boolean);
    const album = htmlText(row[2].match(/<a\b[^>]*class=["'][^"']*\balbum\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]);
    if (!title || !artists.length || seen.has(row[1])) continue;
    seen.add(row[1]); tracks.push({ id: row[1], title, artists, album });
  }
  return tracks;
}

// 벅스의 공식 가수 표기 안에 있는 한국어·영어 별칭만 비교합니다.
const aliases = value => [value, value.replace(/\([^)]*\)/g, ''), ...[...value.matchAll(/\(([^)]+)\)/g)].map(match => match[1])].map(name).filter(Boolean);

export async function getBugsLyrics(track, fetcher = fetch) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  const read = async (url, json = false) => {
    // 배포 런타임이 지원하는 manual 모드로 주소 변경을 확인하고 자동으로 따라가지 않습니다.
    const response = await fetcher(url, { signal: controller.signal, redirect: 'manual',
      headers: { 'User-Agent': 'R1Spotify/1.0', Accept: 'text/html, application/json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('벅스 조회에 실패했습니다. ' + new URL(url).pathname + ' HTTP ' + response.status);
    const text = await response.text();
    if (text.length > 2000000) throw new Error('벅스 응답이 너무 큽니다.');
    if (!json) return text;
    // 잘못된 응답의 본문이나 가사를 오류 기록에 포함하지 않습니다.
    try { return JSON.parse(text); } catch { throw new Error('벅스 가사 응답이 JSON 형식이 아닙니다.'); }
  };
  try {
    const search = new URL('https://music.bugs.co.kr/search/integrated');
    search.searchParams.set('q', track.title + ' ' + track.artist);
    const artistNames = aliases(track.artist);
    const candidates = parseBugsTracks(await read(search.href) || '').filter(item => name(item.title) === name(track.title) &&
      item.artists.some(artist => aliases(artist).some(alias => artistNames.includes(alias))));
    candidates.sort((a, b) => Number(name(b.album) === name(track.album || '')) - Number(name(a.album) === name(track.album || '')));
    for (const item of candidates.slice(0, 3)) {
      const sourceUrl = 'https://music.bugs.co.kr/track/' + item.id;
      const detail = await read(sourceUrl) || '';
      const durationCell = detail.match(/<th\b[^>]*>\s*재생 시간\s*<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1];
      const duration = htmlText(durationCell).match(/^(\d+):([0-5]\d)$/);
      if (!duration || Math.abs(Number(duration[1]) * 60 + Number(duration[2]) - track.duration) > 2) continue;
      const result = await read('https://music.bugs.co.kr/player/lyrics/N/' + item.id, true);
      if (result === null) continue;
      if (typeof result?.lyrics !== 'string') throw new Error('벅스 가사 응답을 확인할 수 없습니다.');
      if (result.lyrics.trim()) return { source: '벅스', sourceUrl, plainLyrics: result.lyrics, syncedLyrics: null, instrumental: false };
    }
    return null;
  } finally { clearTimeout(timer); }
}
