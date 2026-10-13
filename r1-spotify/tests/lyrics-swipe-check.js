// 가사 좌우 스와이프 복귀와 세로 탐색·체크박스·취소 동작을 독립 검증합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 }, reducedMotion: 'reduce' });
  const results = {}, errors = [], commands = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, run) => { try { await run(); results[name] = 'passed'; } catch (error) { results[name] = error.message; } };
  const openLyrics = async () => {
    if (await page.locator('#player-view').isHidden()) await page.keyboard.press('Escape');
    await page.waitForTimeout(520);
    await page.locator('#art-button').click(); await page.locator('#lyrics-lines p.active').waitFor();
  };
  const drag = async (dx, dy) => {
    const area = await page.locator('#lyrics-lines').boundingBox();
    const x = area.x + area.width / 2, y = area.y + area.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 5 }); await page.mouse.up();
  };
  try {
    await context.addInitScript(() => sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'swipe-test', refresh_token: 'swipe-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 })));
    await context.route('https://api.spotify.com/**', route => {
      if (route.request().method() !== 'GET') { commands.push(route.request().url()); return route.fulfill({ status: 204, body: '' }); }
      return route.fulfill({ json: { is_playing: false, progress_ms: 1500, device: { is_restricted: false },
        item: { type: 'track', id: 'lyrics-swipe', name: '가사 스와이프 검증', duration_ms: 180000, artists: [{ name: '시험 가수' }], album: { name: '시험 앨범', images: [] } } } });
    });
    await context.route('**/api/lyrics/bugs?**', route => route.fulfill({ status: 404, json: {} }));
    await context.route('https://lrclib.net/**', route => route.fulfill({ json: { syncedLyrics: Array.from({ length: 30 }, (_, index) => `[00:${String(index * 2).padStart(2, '0')}.00]스와이프 가사 ${index + 1}`).join('\n') } }));
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8791/'); await page.locator('#title').filter({ hasText: '가사 스와이프 검증' }).waitFor();
    await openLyrics();
    await test('backButtonRemoved', async () => check(await page.locator('#lyrics-back').count() === 0, '뒤로 버튼이 남아 있습니다.'));
    for (const [name, dx] of [['swipeLeft', -70], ['swipeRight', 70]]) {
      await openLyrics(); await test(name, async () => {
        await drag(dx, 0); check(await page.locator('#player-view').isVisible(), '좌우 스와이프가 재생 화면을 열지 않습니다.');
        check(await page.locator('#lyrics-view').isHidden(), '스와이프 후 가사 화면이 다시 열렸습니다.');
      });
    }
    await openLyrics();
    await test('verticalGestureStays', async () => { await drag(5, 50); check(await page.locator('#lyrics-view').isVisible(), '세로 탐색을 뒤로 가기로 처리했습니다.'); });
    await test('smallGestureStays', async () => { await drag(15, 0); check(await page.locator('#lyrics-view').isVisible(), '짧은 움직임을 뒤로 가기로 처리했습니다.'); });
    await test('cancelledGestureStays', async () => {
      const area = await page.locator('#lyrics-lines').boundingBox();
      await page.mouse.move(area.x + 20, area.y + area.height / 2); await page.mouse.down();
      await page.mouse.move(area.x + 100, area.y + area.height / 2);
      await page.evaluate(() => document.getElementById('lyrics-view').dispatchEvent(new Event('pointercancel')));
      await page.mouse.up(); check(await page.locator('#lyrics-view').isVisible(), '취소된 움직임을 뒤로 가기로 처리했습니다.');
    });
    await test('checkboxUsable', async () => { await page.locator('#lyrics-lines').click({ position: { x: 25, y: 25 } }); await page.locator('#follow').uncheck(); await page.locator('#follow').check(); check(await page.locator('#follow').isChecked(), '스와이프 처리 때문에 체크박스를 누를 수 없습니다.'); });
    await test('wheelStillScrolls', async () => {
      const before = await page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
      await page.evaluate(() => dispatchEvent(new Event('scrollDown')));
      const after = await page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
      check(after > 0 && after !== before, '가사 휠 탐색이 중단되었습니다.');
    });
    results.noTrackCommand = commands.length === 0 ? 'passed' : '가사 스와이프가 곡 변경 명령을 전송했습니다.';
    results.pageErrors = errors.length ? errors.join(', ') : 'passed';
    check(Object.values(results).every(value => value === 'passed'), JSON.stringify(results));
    return { passed: true, results, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
