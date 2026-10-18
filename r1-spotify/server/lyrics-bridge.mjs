export async function getBridgeLyrics(trackId, language, endpoint, key, fetcher = fetch) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      typeof key !== 'string' || key.length < 32 || key.length > 512 || /[\s\x00-\x1f\x7f]/.test(key)) {
    throw new Error('Invalid lyrics bridge configuration');
  }
  url.pathname = '/api/lyrics/spotify';
  url.searchParams.set('track_id', trackId);
  url.searchParams.set('language', language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Lyrics bridge HTTP ' + response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Invalid lyrics bridge response');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2000000) throw new Error('Lyrics bridge response too large');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const result = await new Response(new Blob(chunks)).json();
    if (result?.source !== 'Spotify' || typeof result.plainLyrics !== 'string' || result.plainLyrics.length > 1000000 ||
        !(result.syncedLyrics === null || typeof result.syncedLyrics === 'string' && result.syncedLyrics.length <= 1000000)) {
      throw new Error('Invalid lyrics bridge response');
    }
    return { source: 'Spotify', language: typeof result.language === 'string' ? result.language.slice(0, 32) : '',
      instrumental: false, plainLyrics: result.plainLyrics, syncedLyrics: result.syncedLyrics };
  } finally { clearTimeout(timer); }
}
