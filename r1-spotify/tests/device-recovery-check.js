// 실기에서 실패할 수 있는 작은 화면·다른 휠 이벤트·불완전한 보안 저장소를 재현합니다.
async (page) => {
  const browser = page.context().browser(), results = {}, errors = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const showControls = async () => { if (await page.locator('#follow').isHidden()) await page.locator('#lyrics-lines').click({ position: { x: 25, y: 25 } }); };
  const test = async (name, run) => { try { await run(); results[name] = 'passed'; } catch (error) { results[name] = error.message; } };
  const raw = { is_playing: false, progress_ms: 45000, device: { id: 'recovery-device', type: 'smartphone', name: '시험 휴대폰', supports_volume: false, volume_percent: 50 },
    item: { type: 'track', id: 'device-recovery', name: '실기 호환 검증 곡', duration_ms: 180000, artists: [{ name: '시험 가수' }], album: { name: '시험 앨범', images: [] } } };
  const context = await browser.newContext({ viewport: { width: 240, height: 240 }, reducedMotion: 'reduce' });
  const tokens = { access_token: 'recovery-access', refresh_token: 'recovery-refresh', clientId: 'a'.repeat(32), expires_in: 3600 };
  let lyrics = { syncedLyrics: Array.from({ length: 40 }, (_, index) => `[${String(Math.floor(index * 3 / 60)).padStart(2, '0')}:${String(index * 3 % 60).padStart(2, '0')}.00]실기 시험 가사 ${index + 1}`).join('\n') };
  const mock = async context => {
    await context.route('https://api.spotify.com/**', route => route.fulfill({ json: raw }));
    await context.route('**/api/lyrics/bugs?**', route => route.fulfill({ status: 404, json: {} }));
    await context.route('https://lrclib.net/**', route => route.fulfill({ json: lyrics }));
  };
  try {
    await mock(context);
    await context.addInitScript(() => {
      sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'test', refresh_token: 'test', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 }));
      // instant 스크롤 동작을 거부하는 오래된 WebView를 모의 처리합니다.
      const original = Element.prototype.scrollBy;
      Element.prototype.scrollBy = function (options, y) {
        if (options?.behavior === 'instant') throw new TypeError('Unsupported scroll behavior');
        return original.call(this, options, y);
      };
      // 옵션 객체를 조용히 무시하는 WebView에서도 현재 가사 이동이 작동해야 합니다.
      const scrollTo = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (options, y) { if (typeof options === 'object') return; return scrollTo.call(this, options, y); };
    });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8791/'); await page.locator('#title').filter({ hasText: raw.item.name }).waitFor();
    await test('shortViewport', async () => {
      for (const height of [240, 212]) {
        await page.setViewportSize({ width: 240, height });
        const layout = await page.evaluate(() => ({ height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
          bottom: Math.max(...['previous', 'toggle', 'next'].map(id => document.getElementById(id).getBoundingClientRect().bottom)) }));
        check(layout.scrollHeight <= height && layout.bottom <= height - 24, '작은 화면에서 하단 버튼의 여유 공간이 부족합니다: ' + JSON.stringify(layout));
      }
    });
    await page.setViewportSize({ width: 240, height: 282 });
    await test('visualViewport', async () => {
      await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 230 }); visualViewport.dispatchEvent(new Event('resize')); });
      const bottom = await page.locator('#toggle').evaluate(element => element.getBoundingClientRect().bottom);
      check(bottom <= 222, '실제로 보이는 화면 높이를 넘어 재생 버튼이 배치됩니다.');
      await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#art-button').click(); await page.locator('#lyrics-lines p.active').waitFor();
    await test('legacyAutoFollow', async () => {
      const visible = () => page.locator('#lyrics-lines').evaluate(area => {
        const line = area.querySelector('.active').getBoundingClientRect(), bounds = area.getBoundingClientRect();
        return line.top >= bounds.top && line.bottom <= bounds.bottom;
      });
      check(await visible(), '체크된 상태에서 현재 가사로 이동하지 않습니다.');
      raw.progress_ms = 90000;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('#lyrics-lines p.active')?.textContent === '실기 시험 가사 31');
      check(await visible(), '재생 위치가 바뀌어도 현재 가사를 계속 따라가지 않습니다.');
    });
    await showControls(); await page.locator('#follow').uncheck();
    const scroll = async (event, target = 'window') => {
      await page.locator('#lyrics-lines').evaluate(element => { element.scrollTop = 100; });
      await page.evaluate(({ event, target }) => (target === 'document' ? document : window).dispatchEvent(new Event(event)), { event, target });
      return page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
    };
    await test('legacyScroll', async () => { check(await scroll('scrollDown') > 100, '오래된 WebView에서 휠 가사 스크롤이 실패합니다.'); });
    await test('documentHardwareEvent', async () => { check(await scroll('scrollDown', 'document') > 100, 'document로 전달된 휠 이벤트가 처리되지 않습니다.'); });
    await test('standardWheel', async () => {
      await page.waitForTimeout(60);
      await page.locator('#lyrics-lines').evaluate(element => { element.scrollTop = 100; });
      await page.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true })));
      check(await page.locator('#lyrics-lines').evaluate(element => element.scrollTop > 100), '표준 wheel 입력이 가사를 움직이지 않습니다.');
    });
    await test('arrowWheel', async () => {
      await page.waitForTimeout(60);
      await page.locator('#lyrics-lines').evaluate(element => { element.scrollTop = 100; });
      await page.locator('#lyrics-lines').focus(); await page.keyboard.press('ArrowDown');
      check(await page.locator('#lyrics-lines').evaluate(element => element.scrollTop >= 160), '방향키 형태로 전달된 휠 입력이 처리되지 않습니다.');
    });
    await test('focusedCheckboxWheel', async () => {
      await showControls(); await page.waitForTimeout(60); await page.locator('#follow').check(); await page.locator('#follow').focus();
      const before = await page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
      await page.keyboard.press('ArrowDown');
      check(await page.locator('#lyrics-lines').evaluate(element => element.scrollTop) > before && !await page.locator('#follow').isChecked(), '체크박스에 초점이 있으면 방향키 휠 입력이 막힙니다.');
      await page.waitForTimeout(60); await page.locator('#follow').check();
      const again = await page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
      await page.locator('#follow').evaluate(element => element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true })));
      check(await page.locator('#lyrics-lines').evaluate(element => element.scrollTop) > again && !await page.locator('#follow').isChecked(), '체크박스에서 발생한 표준 휠 입력이 막힙니다.');
    });
    await page.keyboard.press('Escape');
    await test('phoneVolumeExplanation', async () => {
      await page.evaluate(() => dispatchEvent(new Event('scrollUp')));
      check((await page.locator('#status').getAttribute('title')).includes('휴대폰'), '휴대폰 음량 미지원 이유가 안내되지 않습니다.');
    });
    await test('plainLyricsUnchecksFollow', async () => {
      lyrics = { plainLyrics: '일반 가사 첫 줄\n일반 가사 둘째 줄' };
      await page.evaluate(() => { document.getElementById('follow').checked = true; });
      await page.locator('#art-button').click(); await page.locator('#lyrics-lines.plain').waitFor();
      check(await page.locator('#follow').isDisabled() && !await page.locator('#follow').isChecked(), '시간 정보 없는 가사인데 따라가기가 체크 상태로 표시됩니다.');
      await page.keyboard.press('Escape');
    });
    await test('noOpSecureStorage', async () => {
      const stored = await browser.newContext({ viewport: { width: 240, height: 282 } });
      try {
        await mock(stored);
        await stored.addInitScript(() => { window.creationStorage = { secure: { setItem: async () => {}, getItem: async () => null, removeItem: async () => {} } }; });
        let tab = await stored.newPage(); await tab.goto('http://127.0.0.1:8791/');
        await tab.evaluate(async tokens => { const { SpotifyClient } = await import('/spotify.mjs'); await new SpotifyClient({ redirectUri: new URL('./', location.href).href }).save(tokens); }, tokens);
        await tab.close(); tab = await stored.newPage(); await tab.goto('http://127.0.0.1:8791/');
        await tab.locator('#title').filter({ hasText: raw.item.name }).waitFor({ timeout: 3000 });
      } finally { await stored.close(); }
    });
    await test('lateSecureBridge', async () => {
      const late = await browser.newContext({ viewport: { width: 240, height: 282 } });
      try {
        await mock(late);
        await late.addInitScript(() => {
          Object.defineProperty(window, 'indexedDB', { get() { throw new Error('IndexedDB unavailable'); } });
          setTimeout(() => {
            const values = new Map([['r1_spotify_tokens_v1', btoa(JSON.stringify({ access_token: 'late-test', refresh_token: 'late-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 }))]]);
            window.creationStorage = { secure: { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value), removeItem: async key => values.delete(key) } };
          }, 150);
        });
        const tab = await late.newPage(); await tab.goto('http://127.0.0.1:8791/');
        await tab.locator('#title').filter({ hasText: raw.item.name }).waitFor({ timeout: 3000 });
      } finally { await late.close(); }
    });
    results.pageErrors = errors.length ? errors.join(', ') : 'passed';
    check(Object.values(results).every(value => value === 'passed'), JSON.stringify(results));
    return { passed: true, results, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
