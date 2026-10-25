// A bounded local parser avoids an AI round trip for explicit song commands.
// It does not repair or invent song names: uncertain text remains a candidate search.
const clean = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const endPunctuation = /[.!?。！？]+$/u;
const koreanCommand = /^(.*?)(?:을|를)?\s*(?:좀\s*)?(틀어\s*(?:줘요?|주세요)|들려\s*(?:줘요?|주세요)|재생\s*해\s*(?:줘요?|주세요))$/u;
const uncertainKoreanCommand = /^(.*?)\s+들어\s*줘요?$/u;

export function parseSongRequest(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const text = clean(value).replace(endPunctuation, '').trim();
  if (!text) return null;
  const english = /^(?:please\s+)?play\s+(.+?)\s+by\s+(.+?)(?:,?\s+please)?$/iu.exec(text);
  if (english && english[1].length <= 200 && english[2].length <= 100) {
    return { artist: english[2].trim(), title: english[1].trim(), requiresConfirmation: false };
  }
  // Prefer a particle followed by a space, so an artist such as 김의철 stays intact.
  const korean = /^(.{1,100}?)의\s+(.+)$/u.exec(text) || /^([^의]{1,100})의(.+)$/u.exec(text);
  if (!korean) return null;
  const artist = korean[1].trim(), remainder = korean[2].trim();
  const command = koreanCommand.exec(remainder);
  const uncertain = !command && uncertainKoreanCommand.exec(remainder);
  const title = (command?.[1] || uncertain?.[1] || remainder).trim();
  if (!artist || !title || title.length > 200) return null;
  return { artist, title, requiresConfirmation: !command };
}

// When an artist/title boundary is unclear, search the recognized words as-is.
// Remove only an explicit request at the edge; never invent missing names.
export function createSongSearchRequest(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  let query = clean(value).replace(endPunctuation, '').trim();
  const korean = koreanCommand.exec(query);
  const japanese = /^(.*?)(?:を)?(?:再生して(?:ください)?|かけて(?:ください)?)$/u.exec(query);
  if (korean) query = korean[1].trim();
  else if (japanese) query = japanese[1].trim();
  else if (/^(?:please\s+)?play(?:\s|$)/iu.test(query)) {
    query = query.replace(/^(?:please\s+)?play(?:\s+|$)/iu, '')
      .replace(/,?\s+please$/iu, '').trim();
  }
  if (!query || query.length > 300) return null;
  return { title: query, artist: '', query, requiresConfirmation: true };
}

const comparison = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '').slice(0, 200);
function substitution(left, right) {
  if (left === right) return 0;
  if (!/^[가-힣]$/u.test(left) || !/^[가-힣]$/u.test(right)) return 1;
  // Compare onset/vowel/coda in position rather than letting jamo from different
  // syllables slide together. Missing codas still count as the third position.
  const a = left.normalize('NFD'), b = right.normalize('NFD');
  return ([0, 1, 2].filter(index => a[index] !== b[index]).length) / 3;
}
function distance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + substitution(left[i - 1], right[j - 1]));
    }
    previous = next;
  }
  return previous[right.length];
}
function titleDistance(title, heard) {
  const candidate = comparison(title), query = comparison(heard);
  if (!candidate || !query) return 1;
  let score = distance(candidate, query) / Math.max(candidate.length, query.length);
  // Misheard request endings can stick to a title. Prefix comparison only affects
  // ordering; the original transcript and every actual catalog title stay intact.
  if (query.length > candidate.length) {
    for (let length = Math.max(1, candidate.length - 1); length <= Math.min(query.length, candidate.length + 1); length++) {
      score = Math.min(score, distance(candidate, query.slice(0, length)) / Math.max(candidate.length, length) + 0.15);
    }
  }
  return score;
}

// Hangul syllables are compared by jamo, making e.g. 반/밤 a small difference.
// Never use this fuzzy order as evidence for automatic playback.
export function rankSongCandidates(tracks, { title = '' } = {}) {
  return tracks.map((track, index) => ({ track, index, score: titleDistance(track?.name, title) }))
    .sort((left, right) => left.score - right.score || left.index - right.index).map(item => item.track);
}
