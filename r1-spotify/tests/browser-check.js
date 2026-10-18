// 모의 Spotify·가사 응답으로 확인하며 실제 계정과 래빗 실기 검증을 대신하지 않습니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 } });
  const errors = [], actions = [];
  const track = index => ({ is_playing: true, progress_ms: 1500, actions: {}, device: { is_restricted: false },
    item: { type: 'track', id: `test-${index}`, name: `시험용 곡 ${index}`, duration_ms: 180000,
      artists: [{ name: '시험용 아티스트' }], external_urls: { spotify: 'https://open.spotify.com/track/test' },
      album: { name: '브라우저 검증 앨범', images: [{ url: 'https://i.scdn.co/image/test-cover', width: 300 }] } } });
  let current = track(1), index = 1;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8791/');
    await page.locator('#settings-view').waitFor({ state: 'visible' });
    check(await page.locator('#settings-view').isVisible(), '연결 전 설정 화면이 열리지 않습니다.');
    check(await page.locator('#client-id').inputValue() === '', '새 기기에 공용 Client ID가 표시되면 안 됩니다.');
    await context.addInitScript(() => {
      sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'test', refresh_token: 'test', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 }));
      document.modelContext = { registerTool(tool) { window.testTool = tool; } };
    });
    await context.route('https://api.spotify.com/**', async route => {
      const request = route.request();
      if (request.method() === 'GET') return route.fulfill({ json: current });
      const action = request.url().split('?')[0].split('/').pop(); actions.push(action);
      if (action === 'next') current = track(++index);
      if (action === 'previous') current = track(--index);
      if (action === 'pause' || action === 'play') current.is_playing = action === 'play';
      return route.fulfill({ status: 204, body: '' });
    });
    await context.route('**/api/lyrics/bugs?**', route => route.fulfill({ status: 404, json: {} }));
    await context.route('https://lrclib.net/**', route => route.fulfill({ json: { syncedLyrics: '[00:01.00]첫 번째 시험 문장\n[00:04.00]두 번째 시험 문장\n[00:08.00]세 번째 시험 문장' } }));
    await context.route('https://i.scdn.co/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#284c39"/><text x="150" y="158" text-anchor="middle" fill="white" font-size="24">TEST COVER</text></svg>' }));
    await page.reload(); await page.locator('#title').filter({ hasText: '시험용 곡 1' }).waitFor();
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
    check(size.scrollWidth === 240 && size.scrollHeight === 282, '래빗 화면에 넘침이 있습니다: ' + JSON.stringify(size));
    await page.screenshot({ path: '.project_tmp/checks/player-240x282.png' });
    const art = await page.locator('#art-button').boundingBox();
    const header = await page.locator('.player header').boundingBox(), metadata = await page.locator('.metadata').boundingBox();
    check(art.y >= header.y + header.height && art.y + art.height <= metadata.y, '앨범아트가 제목 또는 머리글과 겹칩니다.');
    async function swipe(left) {
      await page.mouse.move(art.x + (left ? art.width - 15 : 15), art.y + art.height / 2);
      await page.mouse.down();
      await page.mouse.move(art.x + (left ? 15 : art.width - 15), art.y + art.height / 2, { steps: 4 });
      await page.mouse.up();
    }
    await swipe(true); await page.locator('#title').filter({ hasText: '시험용 곡 2' }).waitFor();
    check(await page.locator('#lyrics-view').isHidden(), '스와이프가 가사 클릭으로 중복 처리되었습니다.');
    await page.waitForTimeout(400); await swipe(false); await page.locator('#title').filter({ hasText: '시험용 곡 1' }).waitFor();
    await page.waitForTimeout(400);
    await page.evaluate(() => { dispatchEvent(new Event('sideClick')); dispatchEvent(new Event('sideClick')); });
    await page.waitForFunction(() => document.querySelector('#status').textContent === '일시정지');
    check(actions.join(',') === 'next,previous,pause', '한 동작이 여러 명령으로 전송되었습니다.');
    // 스와이프 뒤 클릭 억제 시간 이후에 독립적인 가사 탭을 시험합니다.
    await page.waitForTimeout(520);
    await page.locator('#art-button').click(); await page.locator('#lyrics-lines p.active').waitFor();
    check(await page.locator('#lyrics-lines p.active').textContent() === '첫 번째 시험 문장', '현재 가사 시간이 맞지 않습니다.');
    current.progress_ms = 5500;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => document.querySelector('#lyrics-lines p.active')?.textContent === '두 번째 시험 문장');
    await page.screenshot({ path: '.project_tmp/checks/lyrics-240x282.png' });
    await page.evaluate(() => dispatchEvent(new Event('scrollDown')));
    check(!await page.locator('#follow').isChecked(), '휠 탐색 후 따라가기가 해제되지 않습니다.');
    await page.locator('#lyrics-lines').click({ position: { x: 25, y: 25 } });
    check(await page.locator('#follow').isVisible(), '탭 후 따라가기 설정이 표시되지 않습니다.');
    await page.locator('#follow').click();
    check(await page.locator('#lyrics-lines p.active').count() === 1, '강조된 가사 줄이 중복되었습니다.');
    await page.waitForTimeout(400);
    const webMcp = await page.evaluate(async () => {
      let rejected = false; try { await window.testTool.execute({ action: 'invalid' }); } catch { rejected = true; }
      return { name: window.testTool.name, rejected, result: await window.testTool.execute({ action: 'toggle' }) };
    });
    check(webMcp.rejected && webMcp.result.applied, '도구 입력 검사 또는 재생 제어에 실패했습니다.');
    check(errors.length === 0, errors.join('\n'));
    return { passed: true, viewport: size, actions, errors, webMcp, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
