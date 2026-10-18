// 기존 화면과 같은 출처에서 벅스를 조회하여 브라우저의 외부 연결 제한을 해결합니다.
import { getBugsLyrics } from './bugs.mjs';
import assets from './assets.mjs';
import { getSpotifyLyrics, validSpotifyLyricsInput } from './spotify-lyrics.mjs';
import { getBridgeLyrics } from './lyrics-bridge.mjs';

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === '/api/lyrics/spotify') {
      const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      if (request.method !== 'GET') return Response.json({ message: 'GET required' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
      const trackId = url.searchParams.get('track_id') || '';
      const language = url.searchParams.get('language') || 'en';
      if (!validSpotifyLyricsInput(trackId, language)) return Response.json({ message: 'Invalid track or language' }, { status: 400, headers });
      if (!env.SPOTIFY_LYRICS_BRIDGE_URL && !env.SPOTIFY_LYRICS_WEB_TOKEN) return Response.json({ message: 'Spotify lyrics session not configured' }, { status: 503, headers });
      try {
        const result = env.SPOTIFY_LYRICS_BRIDGE_URL
          ? await getBridgeLyrics(trackId, language, env.SPOTIFY_LYRICS_BRIDGE_URL, env.SPOTIFY_LYRICS_BRIDGE_KEY)
          : await getSpotifyLyrics(trackId, language, env.SPOTIFY_LYRICS_WEB_TOKEN);
        return Response.json(result || { message: 'Spotify lyrics not found' }, { status: result ? 200 : 404, headers });
      } catch (error) {
        const safeReason = error instanceof Error && /^(Invalid lyrics bridge configuration|Invalid lyrics bridge response|Lyrics bridge response too large|Lyrics bridge HTTP \d{3})$/.test(error.message)
          ? error.message : error instanceof Error ? error.name : 'UnknownError';
        console.error('Spotify lyrics unavailable:', safeReason);
        return Response.json({ message: 'Spotify lyrics unavailable' }, { status: 502, headers });
      }
    }
    if (url.pathname === '/api/lyrics/bugs') {
      if (request.method !== 'GET') return Response.json({ message: 'GET 요청만 사용할 수 있습니다.' }, { status: 405, headers: { Allow: 'GET' } });
      const track = { title: url.searchParams.get('title') || '', artist: url.searchParams.get('artist') || '',
        album: url.searchParams.get('album') || '', duration: Number(url.searchParams.get('duration')) };
      if (!track.title.trim() || !track.artist.trim() || track.title.length > 300 || track.artist.length > 300 || track.album.length > 300 ||
        !Number.isFinite(track.duration) || track.duration <= 0 || track.duration > 86400) {
        return Response.json({ message: '곡 제목·가수·재생 시간을 확인해 주세요.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      }
      try {
        const result = await getBugsLyrics(track);
        return Response.json(result || { message: '벅스에서 일치하는 가사를 찾지 못했습니다.' },
          { status: result ? 200 : 404, headers: { 'Cache-Control': result ? 'private, max-age=300' : 'no-store' } });
      } catch (error) {
        // 조회 주소와 원문은 제외하고 운영 환경의 실패 원인만 기록합니다.
        const reason = error instanceof Error ? (error.name + ': ' + error.message).replace(/https?:\/\/\S+/g, '[조회 주소]') : '알 수 없는 오류';
        console.error('벅스 조회 오류:', reason);
        return Response.json({ message: '벅스 가사를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('GET 요청만 사용할 수 있습니다.', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!asset) return new Response('페이지를 찾을 수 없습니다.', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body,
      { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
  },
};
