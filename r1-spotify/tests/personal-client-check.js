// Playwright callback; OAuth destination is mocked and no real account is used.
async (page) => {
  const browser = page.context().browser();
  for (const locale of ['ko-KR', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 240, height: 282 } });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    let authorization = null;
    await tab.route('https://accounts.spotify.com/authorize**', async route => {
      authorization = new URL(route.request().url());
      await route.fulfill({ contentType: 'text/html', body: 'Mock Spotify authorization' });
    });
    await tab.goto('http://127.0.0.1:8791/');
    await tab.locator('#settings-view').waitFor({ state: 'visible' });
    const check = (value, message) => { if (!value) throw new Error(message); };
    check(await tab.locator('#client-id').inputValue() === '', 'Fresh device must have no default Client ID');
    check(await tab.locator('#setup-guide').getAttribute('open') !== null, 'First-time setup must be expanded');
    check(await tab.locator('#redirect-uri').textContent() === 'http://127.0.0.1:8791/', 'Redirect must match current deployment');
    await tab.locator('#connect').click();
    check(!authorization && await tab.locator('#auth-message').textContent(), 'Missing ID must show an error without authorization');
    await tab.locator('#client-id').fill('invalid');
    await tab.locator('#connect').click();
    check(!authorization, 'Invalid ID must not start authorization');
    const personalId = '0123456789abcdef0123456789abcdef';
    await tab.locator('#client-id').fill(personalId);
    await tab.locator('#connect').click();
    await tab.waitForURL('https://accounts.spotify.com/authorize**');
    check(authorization.searchParams.get('client_id') === personalId, 'OAuth must use the entered ID');
    check(authorization.searchParams.get('redirect_uri') === 'http://127.0.0.1:8791/', 'OAuth redirect mismatch');
    check(authorization.searchParams.get('code_challenge_method') === 'S256' && authorization.searchParams.get('state'), 'PKCE and state required');
    await tab.goto('http://127.0.0.1:8791/');
    await tab.locator('#settings-view').waitFor({ state: 'visible' });
    check(await tab.locator('#client-id').inputValue() === personalId, 'Personal ID must survive reload');
    check(await tab.locator('#setup-guide').getAttribute('open') === null, 'Returning user can skip instructions');
    await tab.evaluate(() => {
      localStorage.removeItem('r1_spotify_personal_client_id');
      localStorage.setItem('r1_spotify_client_id', '3cd6c3a652e44ba0b3f685d4a506a0b8');
    });
    await tab.reload();
    await tab.locator('#settings-view').waitFor({ state: 'visible' });
    check(await tab.locator('#client-id').inputValue() === '', 'Retired shared ID must not be reused');
    await tab.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }); });
    await tab.locator('#copy-redirect').click();
    await tab.waitForFunction(() => Boolean(document.getElementById('copy-message').textContent));
    check(await tab.locator('#copy-message').textContent(), 'Copy action must provide success or fallback feedback');
    let playerCalls = 0;
    await tab.route('https://api.spotify.com/**', async route => { playerCalls++; await route.fulfill({ status: 204 }); });
    await tab.evaluate(() => {
      sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ clientId: '3cd6c3a652e44ba0b3f685d4a506a0b8', access_token: 'mock-old', refresh_token: 'mock-old-refresh', expiresAt: Date.now() + 3600000 }));
    });
    await tab.reload();
    await tab.locator('#settings-view').waitFor({ state: 'visible' });
    check(await tab.locator('#client-id').inputValue() === '', 'Old shared token must not populate the input');
    check(await tab.locator('#disconnect').isHidden(), 'Shared session must be disconnected');
    check(playerCalls === 0, 'Shared session must be removed before playback requests');
    check(!errors.length, errors.join('\n'));
    await context.close();
  }
};
