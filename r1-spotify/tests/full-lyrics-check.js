// Synthetic paragraphs test complete rendering and scrolling, without copying song lyrics.
async (page) => {
  const context = await page.context().browser().newContext({ locale: 'en-US', viewport: { width: 240, height: 282 } });
  await context.addInitScript(() => sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ clientId: 'a'.repeat(32), access_token: 'mock', refresh_token: 'mock', expiresAt: Date.now() + 3600000 })));
  await context.route('https://api.spotify.com/**', route => route.fulfill({ json: { is_playing: true, progress_ms: 0, actions: {}, device: {}, item: { type: 'track', id: 'mock', name: 'Full lyrics test', duration_ms: 180000, artists: [{ name: 'Test' }], album: { name: 'Test', images: [] } } } }));
  const rows = Array.from({ length: 120 }, (_, i) => `Synthetic lyric paragraph ${i + 1}`);
  await context.route('**/api/lyrics/spotify?**', route => route.fulfill({ status: 503, json: {} }));
  await context.route('https://lrclib.net/**', route => route.fulfill({ json: { plainLyrics: rows.join('\r'), syncedLyrics: null } }));
  const tab = await context.newPage(); await tab.goto('http://127.0.0.1:8791/');
  await tab.locator('#title').filter({ hasText: 'Full lyrics test' }).waitFor();
  await tab.locator('#art-button').click();
  await tab.waitForFunction(() => document.querySelectorAll('#lyrics-lines p').length === 120);
  await tab.locator('#lyrics-scroll-hint').waitFor({ state: 'visible' });
  if (await tab.locator('#lyrics-lines p').last().textContent() !== rows[119]) throw new Error('Lyrics were truncated');
  await tab.locator('#lyrics-lines').evaluate(area => { area.scrollTop = area.scrollHeight; });
  await tab.waitForFunction(() => document.getElementById('lyrics-scroll-hint').textContent === 'End of lyrics');
  const last = await tab.locator('#lyrics-lines p').last().boundingBox();
  const area = await tab.locator('#lyrics-lines').boundingBox();
  if (last.y < area.y || last.y + last.height > area.y + area.height) throw new Error('Last paragraph is not reachable');
  await context.close();
};
