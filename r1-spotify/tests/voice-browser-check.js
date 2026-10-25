// Playwright callback. All microphone, AI and Spotify data is simulated; no real audio/account is used.
async (page, { baseURL = 'http://127.0.0.1:8791', screenshotDir } = {}) => {
  const browser = page.context().browser(), reports = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  for (const locale of ['ko-KR', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 240, height: 282 } });
    const errors = [], playback = [], uploads = [];
    let exact = true;
    const uri = 'spotify:track:' + 'a'.repeat(22);
    const track = { uri, id: 'a'.repeat(22), name: '밤편지', type: 'track', duration_ms: 180000,
      artists: [{ name: '아이유' }], album: { name: 'Palette', images: [] } };
    const state = { is_playing: true, progress_ms: 0, actions: {}, device: { id: 'speaker', is_restricted: false }, item: track };
    try {
      await context.addInitScript(() => {
        sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'fake-access', refresh_token: 'fake-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 }));
        window.micCalls = 0; window.micStops = 0;
        window.rabbitTexts = []; window.modelError = false;
        window.PluginMessageHandler = { postMessage(value) {
          const request = JSON.parse(value);
          if (!request.useLLM) return;
          const payload = JSON.parse(request.message.split('Request: ')[1]);
          window.rabbitTexts.push(payload.text);
          queueMicrotask(() => window.onPluginMessage?.({ requestId: payload.requestId, artist: '아이유', title: '밤편지', language: 'ko' }));
        } };
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
          window.micCalls++; return { getTracks: () => [{ stop() { window.micStops++; } }] };
        } } });
        window.MediaRecorder = class {
          static isTypeSupported() { return true; }
          constructor(stream, options) { this.mimeType = options.mimeType; this.state = 'inactive'; }
          start() { this.state = 'recording'; }
          stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: this.mimeType }) }); this.onstop?.(); }); }
        };
      });
      await context.route('**/api/voice/**', route => { uploads.push(route.request().url()); return route.fulfill({ status: 500, json: { error: 'unexpected_paid_route' } }); });
      await context.route('**/local-speech.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
        export class LocalSpeechProbe {
          constructor(options) { this.options = options; this.ready = false; this.supported = true; window.mockRecognizer = this; }
          async prepare() { this.options.onState({ state: 'loading', progress: { progress: 50 } }); this.ready = true; this.options.onState({ state: 'ready' }); }
          async transcribeBlob(blob) {
            if (window.modelError) throw Object.assign(new Error('runtime detail'), { code: 'local_transcription_timeout' });
            return { transcript: '아이유의 밤편지 틀어줘', lang: 'ko' };
          }
          cancel() {} dispose() {}
        }
      ` }));
      await context.route('https://api.spotify.com/**', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/v1/search') return route.fulfill({ json: { tracks: { items: exact ? [track] : [track, { ...track, uri: 'spotify:track:' + 'b'.repeat(22) }] } } });
        if (request.method() !== 'GET') { playback.push({ url: url.pathname, body: request.postDataJSON() }); return route.fulfill({ status: 204, body: '' }); }
        return route.fulfill({ json: state });
      });
      const tab = await context.newPage(); tab.on('pageerror', error => errors.push(error.message));
      await tab.goto(baseURL); await tab.locator('#title').filter({ hasText: '밤편지' }).waitFor();
      await tab.locator('#voice-open').click();
      check(await tab.locator('#voice-record').isDisabled(), 'Capture enabled before model prepared');
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="error"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      check(await tab.evaluate(() => window.micCalls) === 0, 'Unprepared model still opened mic');
      await tab.locator('#voice-prepare').click();
      await tab.locator('#voice-record:not(:disabled)').waitFor();
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-ready-' + locale + '.png' });
      for (const height of [282, 240]) {
        await tab.setViewportSize({ width: 240, height });
        const box = await tab.locator('#voice-record').boundingBox();
        check(box.y >= 0 && box.y + box.height <= height, 'Hold button clipped at ' + height);
        check(await tab.evaluate(() => document.documentElement.scrollWidth === 240), 'Horizontal overflow');
      }
      await tab.setViewportSize({ width: 240, height: 282 });
      if (locale === 'en-US') check(!/[가-힣]/.test(await tab.locator('#voice-panel').innerText()), 'English voice UI contains untranslated text');
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor({ timeout: 5000 }).catch(async error => {
        throw new Error(error.message + '\n' + await tab.locator('#voice-panel').innerText() + '\n' + JSON.stringify(errors));
      });
      await tab.evaluate(() => { window.dispatchEvent(new Event('longPressEnd')); window.dispatchEvent(new Event('sideClick')); });
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 1 && playback[0].body.uris[0] === uri, 'Exact voice request did not play once');
      check(uploads.length === 0, 'Keyless flow called paid voice route');
      check(await tab.evaluate(() => window.rabbitTexts[0]) === '아이유의 밤편지 틀어줘', 'Rabbit did not receive only the transcript');
      check(await tab.evaluate(() => window.micCalls === window.micStops), 'Microphone not released');
      exact = false;
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await tab.locator('#voice-panel[data-phase="choosing"]').waitFor();
      check(playback.length === 1, 'Ambiguous result played automatically');
      check(await tab.locator('#voice-results button').count() === 2, 'Candidates missing');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-candidates-' + locale + '.png' });
      await tab.locator('#voice-results button').nth(1).click();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 2 && playback[1].body.uris[0].endsWith('b'.repeat(22)), 'Candidate selection failed');
      // Escape while recording stops the microphone without upload or playback.
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.keyboard.press('Escape');
      check(await tab.locator('#voice-panel').isHidden(), 'Cancel did not close panel');
      check(uploads.length === 0 && playback.length === 2, 'Cancellation submitted audio');
      check(await tab.evaluate(() => window.micCalls === window.micStops), 'Cancel leaked microphone');
      // Local failures remain actionable and never fall back to a paid service.
      await tab.evaluate(() => { window.modelError = true; });
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await tab.locator('#voice-panel[data-phase="error"]').waitFor();
      check(!(await tab.locator('#voice-state').innerText()).includes('local_transcription_timeout'), 'Raw local error code shown');
      await tab.locator('#voice-cancel').click();
      await tab.evaluate(() => { window.mockRecognizer.ready = false; });
      const micBefore = await tab.evaluate(() => window.micCalls);
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="error"]').waitFor();
      check(await tab.evaluate(() => window.micCalls) === micBefore, 'Unprepared model still opened mic');
      await tab.evaluate(() => { window.modelError = false; });
      await tab.locator('#voice-prepare').click();
      exact = true;
      const hold = await tab.locator('#voice-record').boundingBox();
      await tab.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2); await tab.mouse.down();
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.mouse.up();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 3, 'On-screen hold/release failed');
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      check(await tab.evaluate(() => window.micCalls === window.micStops), 'Leaving page leaked microphone');
      check(uploads.length === 0 && playback.length === 3, 'Leaving page submitted voice');
      check(errors.length === 0, 'Browser errors: ' + errors.join('; '));
      reports.push({ locale, playback: playback.length, uploads: uploads.length, errors });
    } finally { await context.close(); }
  }
  return reports;
}
