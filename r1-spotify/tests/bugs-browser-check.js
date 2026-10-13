// Spotify 재생은 모의 처리하고 시올의 살얼음 가사는 실제 벅스 공개 조회로 확인합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 } });
  const errors = [], outsideRequests = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    await context.addInitScript(() => sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({
      access_token: 'test', refresh_token: 'test', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 })));
    await context.route('https://api.spotify.com/**', route => route.fulfill({ json: {
      is_playing: false, progress_ms: 1000, device: { is_restricted: false },
      item: { type: 'track', id: 'bugs-live-test', name: '살얼음', duration_ms: 206000,
        artists: [{ name: '시올' }], album: { name: '왜곡된 시선', images: [] } },
    } }));
    for (const host of ['https://lrclib.net/**', 'https://api.lyrics.ovh/**']) {
      await context.route(host, route => { outsideRequests.push(route.request().url()); return route.abort(); });
    }
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8791/'); await page.locator('#title').filter({ hasText: '살얼음' }).waitFor();
    const response = page.waitForResponse(value => value.url().includes('/api/lyrics/bugs?'), { timeout: 25000 });
    await page.locator('#art-button').click();
    const reply = await response;
    check(reply.status() === 200, '벅스 실제 조회에 실패했습니다.');
    const result = await reply.json();
    check(result.sourceUrl === 'https://music.bugs.co.kr/track/32794634' && result.plainLyrics.length > 0, '다른 곡을 선택했거나 가사가 비어 있습니다.');
    await page.locator('#lyrics-lines.plain p').first().waitFor();
    await page.locator('#lyrics-lines').click({ position: { x: 30, y: 30 } });
    check(await page.locator('#lyrics-source').textContent() === '가사 · 벅스', '벅스 출처가 표시되지 않습니다.');
    check(await page.locator('#follow').isDisabled() && !await page.locator('#follow').isChecked(), '일반 가사에서 시간 따라가기가 활성화되었습니다.');
    check(outsideRequests.length === 0, '벅스 조회 성공 후 다른 제공처에 요청했습니다.');
    check(errors.length === 0, '브라우저 실행 오류입니다.');
    return { passed: true, source: result.source, sourceUrl: result.sourceUrl, renderedLines: await page.locator('#lyrics-lines p').count(),
      realBugs: true, realSpotify: false, realRabbit: false, errors };
  } catch (error) {
    return { passed: false, error: error.message, errors, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
