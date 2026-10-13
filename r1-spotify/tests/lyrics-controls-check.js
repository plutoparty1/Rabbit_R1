// 가사 정보는 탭할 때만 표시하며 기존 따라가기·탐색·스와이프를 보존합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 }, reducedMotion: 'reduce' });
  const results = {}, errors = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, run) => { try { await run(); results[name] = 'passed'; } catch (error) { results[name] = error.message; } };
  const raw = { is_playing: false, progress_ms: 45000, device: { is_restricted: false },
    item: { type: 'track', id: 'controls-test', name: '가사 정보 표시 검증', duration_ms: 180000, artists: [{ name: '시험 가수' }], album: { name: '시험 앨범', images: [] } } };
  let lyrics = { syncedLyrics: Array.from({ length: 30 }, (_, index) => `[${String(Math.floor(index * 5 / 60)).padStart(2, '0')}:${String(index * 5 % 60).padStart(2, '0')}.00]시험 가사 ${index + 1}`).join('\n') };
  const tap = () => page.locator('#lyrics-lines').click({ position: { x: 30, y: 30 } });
  try {
    await context.addInitScript(() => sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'controls-test', refresh_token: 'controls-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 })));
    await context.route('https://api.spotify.com/**', route => route.fulfill({ json: raw }));
    await context.route('**/api/lyrics/bugs?**', route => route.fulfill({ status: 404, json: {} }));
    await context.route('https://lrclib.net/**', route => route.fulfill({ json: lyrics }));
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8791/'); await page.locator('#title').filter({ hasText: raw.item.name }).waitFor();
    await page.locator('#art-button').click(); await page.locator('#lyrics-lines p.active').waitFor();
    await test('lyricsOnlyByDefault', async () => {
      check(await page.locator('#lyrics-title').isHidden() && await page.locator('#follow').isHidden(), '평소에도 위쪽 안내가 표시됩니다.');
      const area = await page.locator('#lyrics-lines').boundingBox(); check(area.y <= 2 && area.height >= 270, '가사 영역이 화면 전체를 사용하지 않습니다.');
      // 화면 이미지는 영구 검증 자료이며 임시 정리 대상이 아닙니다.
      await page.screenshot({ path: 'C:/Users/정산-PC/jjs1124/r1-spotify/docs/lyrics-only-240x282.png' });
    });
    await test('tapShowsWithoutDisablingFollow', async () => {
      await tap(); check(await page.locator('#lyrics-title').isVisible() && await page.locator('#follow').isVisible(), '탭해도 위쪽 안내가 나오지 않습니다.');
      check(await page.locator('#follow').isChecked(), '안내를 표시하는 탭이 따라가기를 꺼 버립니다.');
      const visible = await page.locator('#lyrics-lines').evaluate(area => { const row = area.querySelector('.active').getBoundingClientRect(), box = area.getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom; });
      check(visible, '안내를 열면 현재 가사 줄이 가려집니다.');
      await page.screenshot({ path: 'C:/Users/정산-PC/jjs1124/r1-spotify/docs/lyrics-controls-240x282.png' });
    });
    await test('tapHides', async () => { await tap(); check(await page.locator('#follow').isHidden(), '다시 탭해도 안내가 숨겨지지 않습니다.'); });
    await test('autoHides', async () => { await tap(); await page.waitForTimeout(3200); check(await page.locator('#follow').isHidden(), '3초가 지나도 안내가 남아 있습니다.'); });
    await test('checkboxRestartsTimer', async () => {
      await tap(); await page.waitForTimeout(2000); await page.locator('#follow').uncheck(); await page.waitForTimeout(1300);
      check(await page.locator('#follow').isVisible(), '체크박스 조작 뒤 안내 시간이 연장되지 않습니다.');
      check(!await page.locator('#follow').isChecked(), '따라가기 해제가 반영되지 않았습니다.');
      await tap();
    });
    await test('freeScrollDoesNotShowControls', async () => {
      await page.locator('#lyrics-lines').evaluate(area => { area.scrollTop = 100; });
      await page.evaluate(() => dispatchEvent(new Event('scrollDown')));
      check(await page.locator('#follow').isHidden() && await page.locator('#lyrics-lines').evaluate(area => area.scrollTop === 165), '휠 탐색이 안내를 표시하거나 이동량을 바꿉니다.');
      await tap(); await tap(); check(await page.locator('#lyrics-lines').evaluate(area => area.scrollTop === 165), '안내를 열고 닫으면 자유 탐색 위치가 초기화됩니다.');
    });
    await test('verticalDragIsNotTap', async () => {
      const area = await page.locator('#lyrics-lines').boundingBox();
      await page.mouse.move(area.x + 80, area.y + 90); await page.mouse.down(); await page.mouse.move(area.x + 82, area.y + 150, { steps: 4 }); await page.mouse.up();
      check(await page.locator('#follow').isHidden() && await page.locator('#lyrics-view').isVisible(), '세로 탐색이 탭이나 복귀로 처리됩니다.');
      await page.waitForTimeout(520);
    });
    await test('keyboardCanShowControls', async () => { await page.locator('#lyrics-lines').focus(); await page.keyboard.press('Enter'); check(await page.locator('#follow').isVisible(), '키보드로 따라가기 설정을 표시할 수 없습니다.'); });
    await page.keyboard.press('Escape'); lyrics = { instrumental: true };
    await page.locator('#art-button').click();
    await test('emptyStateVisibleWithoutTap', async () => {
      await page.locator('#lyrics-empty').filter({ hasText: '가사가 없는 연주곡입니다.' }).waitFor({ timeout: 1500 });
      check(await page.locator('#follow').isHidden(), '가사 없는 상태에서 안내가 항상 펼쳐집니다.');
    });
    results.pageErrors = errors.length ? errors.join(', ') : 'passed';
    check(Object.values(results).every(value => value === 'passed'), JSON.stringify(results));
    return { passed: true, results, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
