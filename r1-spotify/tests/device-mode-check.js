// Playwright callback. OAuth and playback are mocked; checks real browser storage boundaries.
async (page) => {
  for (const mode of ['personal', 'shared']) {
    const context = await page.context().browser().newContext({ locale: 'ko-KR', viewport: { width: 240, height: 282 } });
    const tab = await context.newPage();
    let auth;
    await tab.route('https://accounts.spotify.com/authorize**', async route => { auth = new URL(route.request().url()); await route.fulfill({ contentType: 'text/html', body: 'Mock authorization' }); });
    await tab.route('https://accounts.spotify.com/api/token', route => route.fulfill({ json: { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600 } }));
    await tab.route('https://api.spotify.com/**', route => route.fulfill({ status: 204 }));
    await tab.goto('http://127.0.0.1:8791/');
    await tab.locator('#settings-view').waitFor({ state: 'visible' });
    await tab.locator(`input[name="device-mode"][value="${mode}"]`).check();
    await tab.waitForFunction(() => !document.getElementById('connect').disabled);
    await tab.locator('#client-id').fill('a'.repeat(32));
    await tab.locator('#connect').click();
    await tab.waitForURL('https://accounts.spotify.com/authorize**');
    await tab.goto('http://127.0.0.1:8791/?code=mock-code&state=' + auth.searchParams.get('state'));
    await tab.locator('#player-view').waitFor({ state: 'visible' });
    await tab.waitForFunction(() => !location.search);
    await tab.waitForFunction(() => /로그인 유지:|공용 기기:/.test(document.getElementById('storage-status').textContent));
    const persisted = await tab.evaluate(async () => {
      const record = await new Promise((resolve, reject) => { const request = indexedDB.open('r1_spotify', 1); request.onupgradeneeded = () => request.result.createObjectStore('tokens'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('tokens'); const get = tx.objectStore('tokens').get('r1_spotify_tokens_v1'); get.onsuccess = () => { resolve(get.result); db.close(); }; }; });
      return { record, sessionToken: sessionStorage.getItem('r1_spotify_tokens_v1'), localToken: localStorage.getItem('r1_spotify_tokens_v1'), pending: sessionStorage.getItem('r1_spotify_pkce_v1') || localStorage.getItem('r1_spotify_pkce_v1') };
    });
    if (mode === 'shared' && (persisted.record || persisted.sessionToken || persisted.localToken)) throw new Error('Shared mode persisted credentials');
    if (mode === 'personal' && !persisted.record?.refresh_token) throw new Error('Personal mode did not save credentials');
    if (persisted.pending) throw new Error('Completed OAuth transaction was not cleared');
    await tab.reload();
    await tab.waitForFunction(() => document.getElementById('storage-status').textContent !== '로그인 유지 상태를 확인하고 있습니다.');
    await tab.locator(mode === 'shared' ? '#settings-view' : '#player-view').waitFor({ state: 'visible' });
    if (mode === 'personal') {
      await tab.locator('#settings-button').click();
      await tab.locator('input[value="shared"]').check();
      await tab.waitForFunction(() => !document.getElementById('connect').disabled);
      if (!await tab.locator('#disconnect').isHidden()) throw new Error('Changing mode did not disconnect');
      await tab.reload(); await tab.locator('#settings-view').waitFor({ state: 'visible' });
    }
    await context.close();
  }
};
