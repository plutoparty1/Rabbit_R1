// 앱 복귀 시의 일시적 0 높이와 조회 중단을 모의 처리하며 실기 검증과 구분합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 } });
  const results = {}, errors = [];
  let mode = 'backup', playerReads = 0;
  const raw = { is_playing: false, progress_ms: 1500, device: { is_restricted: false },
    item: { type: 'track', id: 'resume-track', name: '복귀 검증 곡', duration_ms: 180000,
      artists: [{ name: '시험 가수' }], album: { name: '시험 앨범', images: [] } } };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, run) => { try { await run(); results[name] = 'passed'; } catch (error) { results[name] = error.message; } };
  const height = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'));
  const restored = () => page.waitForFunction(() => document.documentElement.style.getPropertyValue('--app-height') === '282px', null, { timeout: 1500 });
  try {
    await context.addInitScript(() => {
      sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({
        access_token: 'test', refresh_token: 'test', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 }));
      // Window 자체의 속성은 삭제만으로 원래 화면 높이가 복원되지 않을 수 있습니다.
      const descriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
      window.restoreTestViewport = () => { Object.defineProperty(window, 'innerHeight', descriptor); delete visualViewport.height; };
    });
    await context.route('https://api.spotify.com/**', route => { playerReads++; return route.fulfill({ json: raw }); });
    await context.route('**/api/lyrics/bugs?**', route => route.fulfill({ status: 404, json: {} }));
    await context.route('https://lrclib.net/**', route => mode === 'error' ? route.abort('failed') : mode === 'backup'
      ? route.fulfill({ status: route.request().url().includes('/api/get?') ? 404 : 200, json: [] })
      : route.fulfill({ json: { syncedLyrics: '[00:01.00]복귀한 가사\n[00:04.00]다음 가사' } }));
    await context.route('https://api.lyrics.ovh/**', route => mode === 'error' ? route.abort('failed')
      : route.fulfill({ json: { lyrics: '<script>표시만 하는 가사</script>\n' + Array.from({ length: 30 }, (_, index) => `일반 가사 ${index + 1}`).join('\n') } }));
    page = await context.newPage(); page.setDefaultTimeout(2000); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8791/'); await page.locator('#title').filter({ hasText: raw.item.name }).waitFor();
    await test('zeroHeightKeepsLastLayout', async () => {
      try {
        await page.evaluate(() => {
          Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
          Object.defineProperty(visualViewport, 'height', { configurable: true, value: 0 });
          window.dispatchEvent(new Event('resize'));
        });
        check(await height() === '282px', '일시적인 0 높이를 1픽셀 화면으로 저장했습니다.');
      } finally {
        await page.evaluate(() => { window.restoreTestViewport(); window.dispatchEvent(new Event('resize')); });
      }
    });
    await test('visibilityRestoresLayout', async () => {
      await page.evaluate(() => { document.documentElement.style.setProperty('--app-height', '1px'); document.dispatchEvent(new Event('visibilitychange')); });
      await restored();
    });
    await test('pageshowRestartsPlayer', async () => {
      raw.item = { ...raw.item, id: 'resumed-track', name: '복귀 후 곡' };
      await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      await page.locator('#title').filter({ hasText: raw.item.name }).waitFor({ timeout: 1500 });
    });
    await test('focusRestoresLayout', async () => {
      await page.evaluate(() => { document.documentElement.style.setProperty('--app-height', '1px'); window.dispatchEvent(new Event('focus')); });
      await restored();
    });
    await test('delayedViewportRecoversWithoutResize', async () => {
      try {
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--app-height', '1px');
          Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
          Object.defineProperty(visualViewport, 'height', { configurable: true, value: 0 });
          document.dispatchEvent(new Event('visibilitychange'));
          setTimeout(() => window.restoreTestViewport(), 200);
        });
        await restored();
      } finally {
        await page.evaluate(() => { window.restoreTestViewport(); window.dispatchEvent(new Event('resize')); });
      }
    });
    await test('resumeSignalsShareOneRefresh', async () => {
      await page.waitForTimeout(150);
      const before = playerReads;
      await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('focus')); });
      await page.waitForTimeout(350);
      check(playerReads === before + 1, '겹친 복귀 신호마다 재생 조회를 중복 전송했습니다.');
    });
    await test('pagehideStopsPolling', async () => {
      const before = playerReads;
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await page.waitForTimeout(3500);
      check(playerReads === before, '앱을 떠난 뒤에도 재생 조회를 계속합니다.');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await page.waitForTimeout(150);
    });
    await test('fallbackLyricsRendersSafely', async () => {
      await page.locator('#art-button').click(); await page.locator('#lyrics-lines.plain p').first().waitFor();
      check(await page.locator('#lyrics-lines p').first().textContent() === '<script>표시만 하는 가사</script>', '대체 가사를 안전한 문자로 표시하지 않습니다.');
      check(await page.locator('#lyrics-lines script').count() === 0, '가사에서 HTML을 실행했습니다.');
      await page.locator('#lyrics-lines').click({ position: { x: 30, y: 30 } });
      check(await page.locator('#lyrics-source').textContent() === '가사 · lyrics.ovh', '대체 제공처를 표시하지 않습니다.');
      check(await page.locator('#follow').isDisabled() && !await page.locator('#follow').isChecked(), '시간 정보가 없는 가사에서 따라가기가 활성화되었습니다.');
    });
    await test('resumeKeepsLyricsScrollPosition', async () => {
      await page.locator('#lyrics-lines').evaluate(area => { area.scrollTop = 100; });
      await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
      await page.waitForTimeout(350);
      check(await page.locator('#lyrics-view').isVisible() && await page.locator('#lyrics-lines').evaluate(area => area.scrollTop === 100), '복귀 시 가사 화면이나 탐색 위치를 초기화했습니다.');
    });
    await page.keyboard.press('Escape');
    mode = 'error';
    await page.locator('#art-button').click();
    await page.locator('#lyrics-empty').filter({ hasText: '가사를 불러오지 못했습니다.' }).waitFor();
    await test('resumeRetriesInterruptedLyrics', async () => {
      mode = 'synced';
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.locator('#lyrics-lines p.active').filter({ hasText: '복귀한 가사' }).waitFor({ timeout: 1500 });
      check(await page.locator('#lyrics-source').textContent() === '가사 · LRCLIB', '복귀 뒤 이전 제공처가 남아 있습니다.');
    });
    check(errors.length === 0, '브라우저 실행 오류입니다: ' + errors.join(', '));
    return { passed: Object.values(results).every(value => value === 'passed'), results, errors, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
