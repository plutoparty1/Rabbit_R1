// 응답 없는 래빗 저장소와 로그인 뒤 새 WebView로 돌아오는 상황을 모의 처리합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 } });
  const errors = [], exchanges = [];
  try {
    await context.addInitScript(() => {
      window.creationStorage = { secure: {
        getItem: () => new Promise(() => {}),
        setItem: () => new Promise(() => {}),
        removeItem: () => new Promise(() => {}),
      } };
    });
    await context.route('https://accounts.spotify.com/api/token', route => {
      exchanges.push(route.request().postData());
      return route.fulfill({ json: { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 } });
    });
    await context.route('https://api.spotify.com/**', route => route.fulfill({ json: {
      is_playing: true, progress_ms: 1000,
      item: { type: 'track', id: 'recovery-test', name: '연결 복구 시험', duration_ms: 30000,
        artists: [{ name: '시험 가수' }], album: { name: '시험 앨범', images: [] } },
    } }));
    let test = await context.newPage();
    test.on('pageerror', error => errors.push(error.message));
    await test.goto('http://127.0.0.1:8791/');
    await test.waitForFunction(() => !document.querySelector('#art-button').disabled, null, { timeout: 5000 });
    const url = await test.evaluate(async () => {
      const { SpotifyClient } = await import('/spotify.mjs');
      const client = new SpotifyClient({ redirectUri: new URL('./', location.href).href });
      return client.authorize(document.querySelector('#client-id').value);
    });
    const state = /[?&]state=([^&]+)/.exec(url)[1];
    await test.close();
    // 브라우저 탭을 새로 만들면 sessionStorage가 사라지지만 같은 출처의 localStorage는 유지됩니다.
    test = await context.newPage(); test.on('pageerror', error => errors.push(error.message));
    await test.goto('http://127.0.0.1:8791/');
    await test.locator('#settings-view').waitFor({ timeout: 5000 });
    if (!(await test.locator('#auth-message').innerText()).includes('로그인 완료를 아직 확인')) throw new Error('중단된 로그인 상태가 설명되지 않습니다.');
    await test.goto('http://127.0.0.1:8791/?code=test-authorization-code&state=' + state);
    await test.locator('#title').filter({ hasText: '연결 복구 시험' }).waitFor({ timeout: 10000 });
    const final = await test.evaluate(() => ({
      queryRemoved: !location.search,
      pendingRemoved: !localStorage.getItem('r1_spotify_pkce_v1'),
      tokensNotInLocalStorage: !localStorage.getItem('r1_spotify_tokens_v1'),
      sessionHasTokens: Boolean(sessionStorage.getItem('r1_spotify_tokens_v1')),
    }));
    // 보안 저장이 멈춘 기기에서도 앱을 완전히 닫은 뒤 로그인 버튼 없이 복원합니다.
    await test.close(); test = await context.newPage(); test.on('pageerror', error => errors.push(error.message));
    await test.goto('http://127.0.0.1:8791/');
    await test.locator('#title').filter({ hasText: '연결 복구 시험' }).waitFor({ timeout: 6000 });
    final.reopenedWithoutLogin = true;
    await test.locator('#settings-button').click(); await test.locator('#disconnect').click();
    await test.waitForFunction(() => document.querySelector('#disconnect').hidden, null, { timeout: 6000 });
    await test.close(); test = await context.newPage();
    // 삭제가 실패한 보안 저장소가 예전 토큰을 반환하더라도 연결 해제 기록을 우선합니다.
    await test.addInitScript(() => {
      window.creationStorage.secure.getItem = async () => btoa(JSON.stringify({
        access_token: 'old-test', refresh_token: 'old-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000,
      }));
    });
    await test.goto('http://127.0.0.1:8791/'); await test.waitForTimeout(300);
    final.disconnectedAfterReopen = await test.locator('#title').textContent() === '재생 중인 음악';
    if (exchanges.length !== 1 || !Object.values(final).every(Boolean) || errors.length) throw new Error(JSON.stringify({ exchanges: exchanges.length, final, errors }));
    return { passed: true, stalledRabbitStorage: 'bounded', freshWebViewCallback: 'completed', ...final,
      exchanges: exchanges.length, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
