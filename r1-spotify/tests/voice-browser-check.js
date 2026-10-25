// Playwright callback. Microphone, AI and Spotify data is simulated; no real audio/account is used.
async (page, { baseURL = 'http://127.0.0.1:8791', screenshotDir } = {}) => {
  const browser = page.context().browser(), reports = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  for (const locale of ['ko-KR', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 240, height: 282 } });
    const errors = [], playback = [], uploads = [], searches = [];
    let bridgeImports = 0;
    let exact = true;
    const uri = 'spotify:track:' + 'a'.repeat(22);
    const track = { uri, id: 'a'.repeat(22), name: '밤편지', type: 'track', duration_ms: 180000,
      artists: [{ name: '아이유' }], album: { name: 'Palette', images: [] } };
    const state = { is_playing: true, progress_ms: 0, actions: {}, device: { id: 'speaker', is_restricted: false }, item: track };
    try {
      await context.addInitScript(() => {
        sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'fake-access', refresh_token: 'fake-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 }));
        window.micCalls = 0; window.micStops = 0; window.micTracks = []; window.recordingCount = 0;
        window.delayMicrophone = false; window.pendingMicrophones = [];
        window.modelLoads = 0; window.modelCancels = 0;
        window.rabbitTexts = []; window.modelError = false; window.delayTranscription = false;
        // No Rabbit text bridge is present: both clear and loose commands must work.
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
          window.micCalls++;
          const track = { kind: 'audio', enabled: true, readyState: 'live', stop() {
            if (this.readyState === 'ended') return;
            this.readyState = 'ended'; window.micStops++;
          } };
          window.micTracks.push(track);
          const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
          if (window.delayMicrophone) await new Promise(resolve => window.pendingMicrophones.push(resolve));
          return stream;
        } } });
        window.MediaRecorder = class {
          static isTypeSupported() { return true; }
          constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; }
          start() {
            if (!this.stream.getTracks().every(track => track.readyState === 'live')) throw new Error('Recorder started without live microphone');
            this.state = 'recording'; window.recordingCount++;
          }
          stop() { this.state = 'inactive'; window.recordingCount--; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: this.mimeType }) }); this.onstop?.(); }); }
        };
      });
      await context.route('**/rabbit-probe.mjs?*', route => { bridgeImports++; return route.abort(); });
      await context.route('**/api/voice/**', route => { uploads.push(route.request().url()); return route.fulfill({ status: 500, json: { error: 'unexpected_paid_route' } }); });
      await context.route('**/local-speech.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
        export class LocalSpeechProbe {
          constructor(options) { this.options = options; this.ready = false; this.supported = true; window.mockRecognizer = this; }
          prepare() {
            if (this.ready) return Promise.resolve();
            if (this.pending) return this.pending;
            window.modelLoads++;
            this.options.onState({ state: 'loading', progress: { progress: 50 } });
            this.pending = new Promise(resolve => { window.finishModel = () => { this.ready = true; this.pending = null; this.options.onState({ state: 'ready' }); resolve(); }; });
            return this.pending;
          }
          async transcribeBlob(blob) {
            await this.prepare();
            this.options.onState({ state: 'transcribing' });
            if (window.modelError) throw Object.assign(new Error('runtime detail'), { code: 'local_transcription_timeout' });
            if (window.delayTranscription) await new Promise(resolve => { window.finishTranscription = resolve; });
            return { transcript: window.testTranscript || '아이유의 밤편지 틀어줘', lang: 'ko' };
          }
          cancel() { window.modelCancels++; } dispose() {}
        }
      ` }));
      await context.route('https://api.spotify.com/**', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/v1/search') { searches.push(url.searchParams.get('q')); return route.fulfill({ json: { tracks: { items: exact ? [track] : [track, { ...track, uri: 'spotify:track:' + 'b'.repeat(22) }] } } }); }
        if (request.method() !== 'GET') { playback.push({ url: url.pathname, body: request.postDataJSON() }); return route.fulfill({ status: 204, body: '' }); }
        return route.fulfill({ json: state });
      });
      const tab = await context.newPage(); tab.on('pageerror', error => errors.push(error.message));
      await tab.goto(baseURL); await tab.locator('#title').filter({ hasText: '밤편지' }).waitFor();
      await tab.waitForFunction(() => window.modelLoads === 1);
      check(await tab.evaluate(() => window.micCalls) === 0, 'Background prepare opened microphone');
      // A physical hold on playback immediately records even before model download completes.
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      check(await tab.evaluate(() => window.micCalls === 1 && window.micTracks[0].enabled && window.recordingCount === 1), 'Physical hold did not start first recording');
      check(await tab.locator('#voice-prepare').isHidden(), 'Normal flow still needs a prepare button');
      check(await tab.evaluate(() => window.mockRecognizer.ready) === false, 'Cold hold test was already warm');
      await tab.keyboard.press('Escape');
      check(await tab.evaluate(() => window.modelCancels) === 0, 'Closing a recording cancelled background model setup');
      check(await tab.evaluate(() => window.micStops === 0 && window.micTracks[0].readyState === 'live' && !window.micTracks[0].enabled && window.recordingCount === 0), 'Closing panel did not retain muted microphone');
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await tab.locator('#voice-panel[data-phase="transcribing"]').waitFor();
      check(playback.length === 0, 'Cold command played before model readiness');
      check(await tab.evaluate(() => window.micCalls === 1 && window.micStops === 0 && !window.micTracks[0].enabled && window.recordingCount === 0), 'Waiting for model recorded audio or reacquired microphone');
      await tab.evaluate(() => window.finishModel());
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 1 && playback[0].body.uris[0] === uri, 'Cold direct hold did not play once');
      check(uploads.length === 0, 'Keyless flow called paid voice route');
      check(await tab.evaluate(() => window.rabbitTexts.length) === 0, 'Clear song command unnecessarily waited for Rabbit AI');
      await tab.locator('#voice-cancel').click();
      await tab.locator('#voice-open').click();
      check(await tab.evaluate(() => window.modelLoads === 1 && window.modelCancels === 0), 'Closing a completed request unloaded the model');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-ready-' + locale + '.png' });
      for (const height of [282, 240]) {
        await tab.setViewportSize({ width: 240, height });
        const box = await tab.locator('#voice-record').boundingBox();
        check(box.y >= 0 && box.y + box.height <= height, 'Hold button clipped at ' + height);
        check(await tab.evaluate(() => document.documentElement.scrollWidth === 240), 'Horizontal overflow');
      }
      await tab.setViewportSize({ width: 240, height: 282 });
      if (locale === 'en-US') check(!/[가-힣]/.test(await tab.locator('#voice-panel').innerText()), 'English voice UI contains untranslated text');
      exact = false;
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => { window.dispatchEvent(new Event('longPressEnd')); window.dispatchEvent(new Event('sideClick')); });
      await tab.locator('#voice-panel[data-phase="choosing"]').waitFor();
      check(await tab.evaluate(() => window.micCalls === 1 && window.micStops === 0 && !window.micTracks[0].enabled && window.recordingCount === 0), 'Three holds failed to reuse one muted microphone connection');
      check(playback.length === 1, 'Ambiguous result played automatically');
      check(await tab.locator('#voice-results button').count() === 2, 'Candidates missing');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-candidates-' + locale + '.png' });
      await tab.locator('#voice-results button').nth(1).click();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 2 && playback[1].body.uris[0].endsWith('b'.repeat(22)), 'Candidate selection failed');
      check(await tab.evaluate(() => window.modelLoads) === 1, 'Warm command loaded model again');
      // Explicit cancellation during local inference prevents any later request or playback.
      await tab.evaluate(() => { window.delayTranscription = true; window.dispatchEvent(new Event('longPressStart')); });
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await tab.waitForFunction(() => Boolean(window.finishTranscription));
      await tab.keyboard.press('Escape');
      await tab.evaluate(() => { window.finishTranscription(); window.delayTranscription = false; });
      check(await tab.evaluate(() => window.modelCancels) > 0, 'Closing inference did not cancel work');
      check(uploads.length === 0 && playback.length === 2, 'Cancelled inference sent playback');
      // Local failures remain actionable and never fall back to a paid service.
      await tab.evaluate(() => { window.modelError = true; window.dispatchEvent(new Event('longPressStart')); });
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await tab.locator('#voice-panel[data-phase="error"]').waitFor();
      check(!(await tab.locator('#voice-state').innerText()).includes('local_transcription_timeout'), 'Raw local error code shown');
      await tab.evaluate(() => { window.modelError = false; });
      exact = true;
      const hold = await tab.locator('#voice-record').boundingBox();
      await tab.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2); await tab.mouse.down();
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.mouse.up();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 3, 'On-screen hold/release failed');
      await tab.locator('#voice-cancel').click();
      await tab.evaluate(() => { window.testTranscript = '아이유 밤편지 틀어줘'; window.dispatchEvent(new Event('longPressStart')); });
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await tab.locator('#voice-panel[data-phase="choosing"]').waitFor();
      check(searches.at(-1) === '아이유 밤편지', 'Loose speech did not become a direct Spotify query');
      check(playback.length === 3, 'Loose speech played without a choice');
      check(bridgeImports === 0 && await tab.evaluate(() => typeof window.PluginMessageHandler === 'undefined'), 'Player still depends on Rabbit text bridge');
      await tab.locator('#voice-cancel').click();
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await tab.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      check(await tab.evaluate(() => window.micCalls === window.micStops), 'Leaving page leaked microphone');
      check(uploads.length === 0 && playback.length === 3, 'Leaving page submitted voice');
      await tab.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await tab.locator('#voice-open:not([disabled])').waitFor();
      check(await tab.evaluate(() => window.micCalls === 1 && window.recordingCount === 0), 'Returning to app acquired microphone without a hold');
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      check(await tab.evaluate(() => window.micCalls === 2 && window.micTracks[1].enabled), 'First hold after return did not reopen microphone');
      await tab.keyboard.press('Escape');
      await tab.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      check(await tab.evaluate(() => window.micStops === 2 && window.recordingCount === 0), 'Hiding an idle app did not release cached microphone');
      await tab.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      check(await tab.evaluate(() => window.micCalls === 2), 'Visibility resume acquired microphone without a hold');
      // Permission can finish after suspension. Its late stream must be discarded.
      await tab.evaluate(() => { window.delayMicrophone = true; window.dispatchEvent(new Event('longPressStart')); });
      await tab.locator('#voice-panel[data-phase="preparing"]').waitFor();
      await tab.waitForFunction(() => window.pendingMicrophones.length === 1);
      await tab.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.pendingMicrophones.shift()(); window.delayMicrophone = false;
      });
      await tab.waitForFunction(() => window.micStops === 3);
      check(await tab.evaluate(() => window.micTracks.every(track => track.readyState === 'ended') && window.recordingCount === 0), 'Late permission cached a live microphone after hide');
      await tab.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      check(await tab.evaluate(() => window.micCalls === 3), 'Return after late permission acquired microphone without a hold');
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor();
      check(await tab.evaluate(() => window.micCalls === 4), 'New hold reused invalidated permission stream');
      await tab.keyboard.press('Escape');
      await tab.locator('#settings-button').click();
      await tab.locator('#disconnect').click();
      await tab.waitForFunction(() => window.micStops === 4);
      check(await tab.evaluate(() => window.micTracks.every(track => track.readyState === 'ended') && window.recordingCount === 0), 'Disconnect retained microphone');
      check(uploads.length === 0 && playback.length === 3, 'Lifecycle cleanup submitted voice');
      const modeTab = await context.newPage(); modeTab.on('pageerror', error => errors.push(error.message));
      await modeTab.goto(baseURL); await modeTab.locator('#title').filter({ hasText: '밤편지' }).waitFor();
      await modeTab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await modeTab.locator('#voice-panel[data-phase="recording"]').waitFor();
      await modeTab.keyboard.press('Escape');
      check(await modeTab.evaluate(() => window.micStops === 0 && !window.micTracks[0].enabled), 'Mode test did not start with a cached muted microphone');
      await modeTab.locator('#settings-button').click();
      await modeTab.locator('input[name="device-mode"][value="shared"]').check();
      await modeTab.waitForFunction(() => window.micStops === 1);
      check(await modeTab.evaluate(() => window.recordingCount === 0 && window.micCalls === 1), 'Session-mode change did not release microphone');
      await modeTab.close();
      check(errors.length === 0, 'Browser errors: ' + errors.join('; '));
      reports.push({ locale, playback: playback.length, uploads: uploads.length, modelLoads: await tab.evaluate(() => window.modelLoads), microphoneRequests: await tab.evaluate(() => window.micCalls), repeatedHoldsRequests: 1, lifecycleStops: await tab.evaluate(() => window.micStops), sessionModeRelease: true, bridgeImports, looseQuery: true, errors });
    } finally { await context.close(); }
  }
  return reports;
}
