// 실제 계정 없이 로그인 복원과 래빗 화면의 다섯 가지 개선을 검증합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 }, reducedMotion: 'reduce' });
  const results = {}, errors = [], exchanges = [], actions = [];
  let current = { is_playing: false, progress_ms: 45000, actions: {}, device: { is_restricted: false },
    item: { type: 'track', id: 'improvement-test', name: '개선 검증 곡', duration_ms: 180000,
      artists: [{ name: '시험 가수' }], album: { name: '시험 앨범', images: [] } } };
  let lyrics = { syncedLyrics: Array.from({ length: 30 }, (_, index) => `[${String(Math.floor(index * 5 / 60)).padStart(2, '0')}:${String(index * 5 % 60).padStart(2, '0')}.00]시험 가사 ${index + 1}`).join('\n') };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const showControls = async () => { if (await page.locator('#follow').isHidden()) await page.locator('#lyrics-lines').click({ position: { x: 25, y: 25 } }); };
  const test = async (name, run) => {
    try { await run(); results[name] = 'passed'; } catch (error) { results[name] = error.message; }
  };
  const open = async () => {
    const tab = await context.newPage(); tab.on('pageerror', error => errors.push(error.message));
    await tab.goto('http://127.0.0.1:8791/'); return tab;
  };
  try {
    await context.route('https://accounts.spotify.com/api/token', route => {
      exchanges.push(/(?:^|&)grant_type=([^&]+)/.exec(route.request().postData())?.[1]);
      return route.fulfill({ json: { access_token: 'renewed-test', refresh_token: 'rotated-test', expires_in: 3600 } });
    });
    await context.route('https://api.spotify.com/**', route => {
      if (route.request().method() !== 'GET') { actions.push(route.request().url().split('/').pop()); return route.fulfill({ status: 204, body: '' }); }
      return route.fulfill({ json: current });
    });
    await context.route('**/api/lyrics/bugs?**', route => route.fulfill({ status: 404, json: {} }));
    await context.route('https://lrclib.net/**', route => route.fulfill({ json: lyrics }));
    page = await open();
    await page.evaluate(async () => {
      const { SpotifyClient } = await import('/spotify.mjs');
      await new SpotifyClient({ redirectUri: new URL('./', location.href).href }).save({
        access_token: 'expired-test', refresh_token: 'refresh-test', clientId: 'a'.repeat(32), expires_in: 1,
      });
    });
    await page.close(); page = await open();
    await test('loginPersistence', async () => {
      await page.locator('#title').filter({ hasText: '개선 검증 곡' }).waitFor({ timeout: 5000 });
      check(exchanges.join(',') === 'refresh_token', '재실행 시 만료 토큰이 자동 갱신되지 않습니다.');
      check(await page.evaluate(() => !localStorage.getItem('r1_spotify_tokens_v1')), '토큰이 localStorage에 노출되었습니다.');
    });
    // 로그인 결함이 있더라도 나머지 화면 결함은 독립적으로 재현합니다.
    if (results.loginPersistence !== 'passed') {
      await page.evaluate(() => sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({
        access_token: 'test', refresh_token: 'test', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000,
      })));
      await page.reload();
    }
    await page.locator('#title').filter({ hasText: '개선 검증 곡' }).waitFor();
    await test('unclippedControls', async () => {
      // 큰 브라우저용 화면 규칙에서도 버튼이 잘리지 않는지 확인합니다.
      for (const viewport of [{ width: 240, height: 282 }, { width: 240, height: 360 }, { width: 360, height: 640 }]) {
        await page.setViewportSize(viewport);
        const layout = await page.evaluate(() => ({ height: innerHeight, documentHeight: document.documentElement.scrollHeight,
          buttons: ['previous', 'toggle', 'next'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, top: r.top, bottom: r.bottom, height: r.height }; }),
          row: document.querySelector('.controls').getBoundingClientRect().height }));
        check(layout.documentHeight === layout.height && layout.row >= 44 && layout.buttons.every(button => button.height >= 44 && button.bottom <= layout.height - 8), '재생 버튼이 행을 넘거나 화면 하단 여백이 부족합니다: ' + JSON.stringify(layout));
      }
    });
    await page.setViewportSize({ width: 240, height: 282 });
    await page.locator('#art-button').click(); await page.locator('#lyrics-lines p.active').waitFor();
    await test('rabbitWheelScroll', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      // 연속 휠 입력을 한 번의 스크롤 애니메이션으로 합치지 않고 모두 반영합니다.
      await showControls(); await page.locator('#follow').uncheck();
      const before = await page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
      await page.evaluate(() => { for (let index = 0; index < 3; index++) dispatchEvent(new Event('scrollDown')); });
      await page.waitForTimeout(100);
      const down = await page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
      await page.evaluate(() => dispatchEvent(new Event('scrollUp')));
      await page.waitForTimeout(100);
      const up = await page.locator('#lyrics-lines').evaluate(element => element.scrollTop);
      check(Math.abs(down - before - 195) <= 1 && up < down, '래빗 휠의 연속 입력으로 긴 가사를 위아래로 이동할 수 없습니다.');
      await page.emulateMedia({ reducedMotion: 'reduce' });
    });
    await test('followCheckbox', async () => {
      await showControls();
      const follow = page.locator('#follow');
      check(await follow.getAttribute('type') === 'checkbox', '현재 가사 따라가기 체크박스가 없습니다.');
      await follow.check();
      check(await follow.isChecked(), '체크 시 자동 이동이 켜지지 않습니다.');
      await follow.uncheck();
      await page.locator('#lyrics-lines').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
      current.progress_ms = 80000;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('#lyrics-lines p.active')?.textContent === '시험 가사 17');
      check(await page.locator('#lyrics-lines').evaluate(element => element.scrollTop) === 0, '해제했는데 재생 위치로 강제 이동합니다.');
      await follow.check();
      check(await page.locator('#lyrics-lines').evaluate(element => {
        const row = element.querySelector('.active'), bounds = element.getBoundingClientRect(), line = row.getBoundingClientRect();
        return line.top >= bounds.top && line.bottom <= bounds.bottom;
      }), '다시 체크해도 현재 재생 가사가 화면에 보이지 않습니다.');
      await page.evaluate(() => dispatchEvent(new Event('scrollDown')));
      check(!await follow.isChecked(), '휠로 탐색했는데 자동 이동 체크가 유지됩니다.');
    });
    await test('backToPlayer', async () => {
      check(await page.locator('#lyrics-back').count() === 0, '좌우 스와이프 복귀 대신 뒤로 버튼이 남아 있습니다.');
      const area = await page.locator('#lyrics-lines').boundingBox();
      await page.mouse.move(area.x + 30, area.y + area.height / 2); await page.mouse.down();
      await page.mouse.move(area.x + 110, area.y + area.height / 2, { steps: 4 }); await page.mouse.up();
      check(await page.locator('#player-view').isVisible(), '가사 스와이프가 재생 화면을 열지 않습니다.');
      await page.waitForTimeout(520);
      await page.locator('#art-button').click(); await page.locator('#lyrics-lines p.active').waitFor();
      await showControls();
      await page.locator('#follow').focus(); await page.keyboard.press('Escape');
      check(await page.locator('#player-view').isVisible(), '체크박스에 초점이 있을 때 뒤로 가기가 막힙니다.');
    });
    // 시간 없는 가사는 휠 탐색만 허용하며 오해를 주는 따라가기 기능을 비활성화합니다.
    if (results.followCheckbox === 'passed' && results.backToPlayer === 'passed') {
      await test('plainLyrics', async () => {
        lyrics = { plainLyrics: Array.from({ length: 30 }, (_, index) => `일반 가사 ${index + 1}`).join('\n') };
        await page.locator('#art-button').click(); await page.locator('#lyrics-lines.plain').waitFor();
        check(await page.locator('#follow').isDisabled(), '일반 가사에서 따라가기 기능이 활성화되었습니다.');
        await page.evaluate(() => dispatchEvent(new Event('scrollDown')));
        check(await page.locator('#lyrics-lines').evaluate(element => element.scrollTop > 0), '일반 가사가 휠로 이동하지 않습니다.');
        await page.keyboard.press('Escape');
      });
    }
    if (results.loginPersistence === 'passed') {
      await test('disconnectPersistence', async () => {
        await page.locator('#settings-button').click(); await page.locator('#disconnect').click();
        await page.waitForFunction(() => document.querySelector('#disconnect').hidden);
        await page.close(); page = await open(); await page.waitForTimeout(200);
        check(await page.locator('#title').textContent() === '재생 중인 음악', '연결 해제 뒤 저장된 로그인 정보가 복원되었습니다.');
      });
    }
    check(errors.length === 0, '브라우저 실행 오류: ' + errors.join(', '));
    check(Object.values(results).every(result => result === 'passed'), JSON.stringify(results));
    return { passed: true, results, errors, actions, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
