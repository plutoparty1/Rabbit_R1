export function validSpotifyLyricsInput(trackId, language) {
  return /^[a-zA-Z0-9]{22}$/.test(trackId) && /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(language);
}

export async function getSpotifyLyrics(trackId, language, webToken, fetcher = fetch) {
  if (!validSpotifyLyricsInput(trackId, language) || typeof webToken !== 'string' ||
      !webToken || webToken.length > 8192 || /[\s\x00-\x1f\x7f]/.test(webToken)) {
    throw new Error('Invalid Spotify lyrics configuration');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const url = new URL('https://spclient.wg.spotify.com/color-lyrics/v2/track/' + trackId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('market', 'from_token');
    const response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + webToken, 'App-Platform': 'WebPlayer',
        Accept: 'application/json', 'Accept-Language': language } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Provider rejected request');
    const data = await response.json();
    const lyrics = data?.lyrics;
    if (!lyrics || !Array.isArray(lyrics.lines)) throw new Error('Invalid response');
    if (lyrics.lines.length === 0) return null;
    if (lyrics.lines.length > 10000 || lyrics.lines.some(line => typeof line.words !== 'string' || line.words.length > 10000)) {
      throw new Error('Invalid lyrics');
    }
    const synced = lyrics.syncType === 'LINE_SYNCED';
    const lines = lyrics.lines.map(line => {
      const text = line.words.replace(/[\r\n]+/g, ' ');
      if (!synced) return { text };
      const ms = Number(line.startTimeMs);
      if (!/^\d+$/.test(String(line.startTimeMs)) || !Number.isSafeInteger(ms) || ms > 86400000) throw new Error('Invalid timing');
      const minutes = Math.floor(ms / 60000).toString().padStart(2, '0');
      const seconds = Math.floor(ms % 60000 / 1000).toString().padStart(2, '0');
      const fraction = Math.floor(ms % 1000 / 10).toString().padStart(2, '0');
      return { text, lrc: '[' + minutes + ':' + seconds + '.' + fraction + ']' + text };
    });
    if (!lines.some(line => line.text.trim())) return null;
    return { source: 'Spotify', language: typeof lyrics.language === 'string' ? lyrics.language : '',
      instrumental: false, plainLyrics: lines.map(line => line.text).join('\n'),
      syncedLyrics: synced ? lines.map(line => line.lrc).join('\n') : null };
  } catch {
    throw new Error('Spotify lyrics unavailable');
  } finally {
    clearTimeout(timeout);
  }
}
