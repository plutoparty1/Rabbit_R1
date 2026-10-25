// Playwright callback; controlled microphone/model/Spotify responses, no real account or audio.
async (page, { baseURL = 'http://127.0.0.1:8791', screenshotDir } = {}) => {
  const browser = page.context().browser(), reports = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  for (const locale of ['ko-KR', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 240, height: 282 } });
    const errors = [], playback = [], uploads = [], searches = [];
    let bridgeImports = 0, exact = true, finishPlayer;
    const playerGate = new Promise(resolve => { finishPlayer = resolve; });
    const uri = 'spotify:track:' + 'a'.repeat(22);
    const track = { uri, id: 'a'.repeat(22), name: '밤편지', type: 'track', duration_ms: 180000,
      artists: [{ name: '아이유' }], album: { name: 'Palette', images: [] } };
    const state = { is_playing: true, progress_ms: 0, actions: {}, device: { id: 'speaker', is_restricted: false }, item: track };
    try {
      await context.addInitScript(() => {
        sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'fake-access', refresh_token: 'fake-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 }));
        window.micCalls = 0; window.micStops = 0; window.micTracks = []; window.recordingCount = 0; window.recorderInstances = [];
        window.delayMicrophone = true; window.pendingMicrophones = []; window.denyMicrophone = false;
        window.delayRecorderStart = true; window.delayRecorderResume = false; window.vibrations = [];
        window.wakeRequests = 0; window.wakeReleases = 0;
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: duration => { window.vibrations.push(duration); return true; } });
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
          window.wakeRequests++; const lock = new EventTarget(); lock.released = false;
          lock.release = async () => { if (!lock.released) { lock.released = true; window.wakeReleases++; lock.dispatchEvent(new Event('release')); } }; return lock;
        } } });
        window.modelLoads = 0; window.modelCancels = 0; window.modelError = false; window.delayTranscription = false;
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
          window.micCalls++;
          if (window.denyMicrophone) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
          const track = { kind: 'audio', enabled: true, readyState: 'live', stop() { if (this.readyState === 'ended') return; this.readyState = 'ended'; window.micStops++; } };
          window.micTracks.push(track);
          const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
          if (window.delayMicrophone) await new Promise(resolve => window.pendingMicrophones.push(resolve));
          return stream;
        } } });
        window.MediaRecorder = class {
          static isTypeSupported() { return true; }
          constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; window.recorderInstances.push(this); }
          start() { this.state = 'recording'; window.recordingCount++; const run = () => { if (this.state === 'recording') this.onstart?.(); }; if (window.delayRecorderStart) window.finishRecorderStart = run; else queueMicrotask(run); }
          pause() { if (this.state === 'recording') window.recordingCount--; this.state = 'paused'; queueMicrotask(() => this.onpause?.()); }
          resume() { this.state = 'recording'; window.recordingCount++; const run = () => { if (this.state === 'recording') this.onresume?.(); }; if (window.delayRecorderResume) window.finishRecorderResume = run; else queueMicrotask(run); }
          stop() { if (this.state === 'recording') window.recordingCount--; this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: this.mimeType }) }); this.onstop?.(); }); }
        };
      });
      await context.route('**/rabbit-probe.mjs?*', route => { bridgeImports++; return route.abort(); });
      await context.route('**/api/voice/**', route => { uploads.push(route.request().url()); return route.fulfill({ status: 500, json: { error: 'unexpected_paid_route' } }); });
      await context.route('**/local-speech.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
        export class LocalSpeechProbe {
          constructor(options) { this.options = options; this.ready = false; this.supported = !new URL(location.href).searchParams.has('test-unsupported'); window.mockRecognizer = this; }
          prepare() {
            if (this.ready) return Promise.resolve(); if (this.pending) return this.pending;
            window.modelLoads++; this.options.onState({ state: 'loading', progress: { progress: 50 } });
            this.pending = new Promise(resolve => { window.finishModel = () => { this.ready = true; this.pending = null; this.options.onState({ state: 'ready' }); resolve(); }; }); return this.pending;
          }
          async transcribeBlob() {
            await this.prepare(); this.options.onState({ state: 'transcribing' });
            if (window.modelError) throw Object.assign(new Error('runtime detail'), { code: 'local_transcription_timeout' });
            if (window.delayTranscription) await new Promise(resolve => { window.finishTranscription = resolve; });
            return { transcript: window.testTranscript || '아이유의 밤편지 틀어줘', lang: 'ko' };
          }
          cancel() { window.modelCancels++; } dispose() {}
        }
      ` }));
      await context.route('https://api.spotify.com/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/v1/search') { searches.push(url.searchParams.get('q')); return route.fulfill({ json: { tracks: { items: exact ? [track] : [track, { ...track, uri: 'spotify:track:' + 'b'.repeat(22) }] } } }); }
        if (request.method() !== 'GET') { playback.push({ url: url.pathname, body: request.postDataJSON() }); return route.fulfill({ status: 204, body: '' }); }
        await playerGate; return route.fulfill({ json: state });
      });
      const tab = await context.newPage(); tab.on('pageerror', error => errors.push(error.message));
      await tab.goto(baseURL);
      await tab.waitForFunction(() => window.modelLoads === 1 && window.micCalls === 1 && window.pendingMicrophones.length === 1);
      check(await tab.locator('#voice-open').getAttribute('data-ready') === 'false', 'Startup prematurely advertised ready');
      check(await tab.evaluate(() => window.wakeRequests === 1 && window.wakeReleases === 0), 'Startup preparation has no screen-wake request');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-startup-' + locale + '.png' });
      await tab.evaluate(() => { window.dispatchEvent(new Event('longPressStart')); window.dispatchEvent(new Event('longPressEnd')); });
      await tab.locator('#voice-panel[data-phase="warming"]').waitFor();
      check(!/계속 누르고|Keep holding|아직 말하지/.test(await tab.locator('#voice-panel').innerText()), 'Cold input asks user to keep holding');
      check(await tab.locator('#voice-record').isDisabled(), 'Cold capture control is enabled');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-preparing-' + locale + '.png' });
      await tab.locator('#voice-cancel').click();
      await tab.evaluate(() => { window.delayMicrophone = false; window.pendingMicrophones.shift()(); });
      await tab.waitForFunction(() => Boolean(window.finishRecorderStart));
      check(await tab.evaluate(() => !window.micTracks[0].enabled), 'Recorder setup captured ambient voice');
      await tab.evaluate(() => { window.delayRecorderStart = false; window.finishRecorderStart(); });
      await tab.waitForFunction(() => window.recorderInstances.some(recorder => recorder.state === 'paused'));
      check(await tab.locator('#voice-open').getAttribute('data-ready') === 'false', 'Mic alone advertised ready before model');
      await tab.evaluate(() => window.finishModel());
      await tab.locator('#voice-open[data-ready="true"]').waitFor();
      check(await tab.evaluate(() => window.recordingCount === 0 && window.micTracks[0].enabled && window.vibrations.length === 0), 'Released cold input started later or standby source is not live');
      check(await tab.evaluate(() => window.wakeRequests === window.wakeReleases), 'Finished preparation retained wake lock');
      finishPlayer(); await tab.locator('#title').filter({ hasText: '밤편지' }).waitFor();
      const ready = () => tab.locator('#voice-open[data-ready="true"]').waitFor();
      const begin = async () => { await ready(); await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart'))); await tab.locator('#voice-panel[data-phase="recording"]').waitFor(); };
      const release = () => tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await begin();
      check(await tab.evaluate(() => window.micCalls === 1 && window.micTracks[0].enabled && window.recordingCount === 1 && window.vibrations.length === 1), 'First hold did not reuse prepared recorder');
      check(await tab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '지금 말하세요' : 'Speak now'), 'Recording cue missing');
      await tab.waitForFunction(() => document.getElementById('voice-elapsed').textContent !== '0:00');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-recording-' + locale + '.png' });
      await tab.setViewportSize({ width: 240, height: 240 });
      const recordBox = await tab.locator('#voice-record').boundingBox(), hintBox = await tab.locator('#voice-instruction').boundingBox(), contentBox = await tab.locator('#voice-content').boundingBox();
      check(recordBox.y + recordBox.height <= 240 && hintBox.y + hintBox.height <= contentBox.y + contentBox.height, 'Recording controls clipped');
      check(await tab.evaluate(() => document.documentElement.scrollWidth === 240), 'Horizontal overflow');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-recording-compact-' + locale + '.png' });
      await tab.setViewportSize({ width: 240, height: 282 });
      await tab.evaluate(() => { window.delayTranscription = true; }); await release();
      await tab.locator('#voice-panel[data-phase="transcribing"]').waitFor();
      check(await tab.locator('#voice-recording').isHidden(), 'Recording clock remains after release');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-processing-' + locale + '.png' });
      await tab.waitForFunction(() => Boolean(window.finishTranscription));
      await tab.evaluate(() => { window.finishTranscription(); window.delayTranscription = false; });
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 1 && playback[0].body.uris[0] === uri, 'First request failed');
      await tab.locator('#voice-cancel').click(); await ready(); await tab.locator('#voice-open').click();
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-ready-' + locale + '.png' });
      if (locale === 'en-US') check(!/[가-힣]/.test(await tab.locator('#voice-panel').innerText()), 'Untranslated English UI');
      exact = false; await begin(); await release();
      await tab.locator('#voice-panel[data-phase="choosing"]').waitFor();
      check(playback.length === 1 && await tab.locator('#voice-results button').count() === 2, 'Ambiguous search did not offer candidates');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-candidates-' + locale + '.png' });
      await tab.locator('#voice-results button').nth(1).click(); await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      exact = true; await ready();
      const hold = await tab.locator('#voice-record').boundingBox();
      await tab.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2); await tab.mouse.down();
      await tab.locator('#voice-panel[data-phase="recording"]').waitFor(); await tab.mouse.up();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor(); await ready();
      check(playback.length === 3 && await tab.evaluate(() => window.micCalls === 1 && window.modelLoads === 1), 'Repeated holds reloaded or failed');
      // Pointer release during delayed resume cancels, never starts after release.
      await tab.evaluate(() => { window.delayRecorderResume = true; });
      await tab.mouse.down(); await tab.locator('#voice-panel[data-phase="preparing"]').waitFor();
      check(await tab.locator('#voice-record').isEnabled(), 'Resume transition disables pointer release');
      await tab.mouse.up(); await tab.evaluate(() => { window.finishRecorderResume(); window.delayRecorderResume = false; });
      await ready(); check(await tab.evaluate(() => window.recordingCount === 0), 'Late resume recorded released input');
      await tab.evaluate(() => { window.testTranscript = '아이유 밤편지 틀어줘'; }); await begin(); await release();
      await tab.locator('#voice-panel[data-phase="choosing"]').waitFor();
      check(searches.at(-1) === '아이유 밤편지' && playback.length === 3, 'Loose speech auto-played');
      await tab.keyboard.press('Escape');
      await tab.evaluate(() => { window.delayTranscription = true; window.finishTranscription = null; }); await begin(); await release();
      await tab.waitForFunction(() => Boolean(window.finishTranscription)); await tab.keyboard.press('Escape');
      await tab.evaluate(() => { window.finishTranscription(); window.delayTranscription = false; });
      check(playback.length === 3 && await tab.evaluate(() => window.modelCancels) > 0, 'Cancelled recognition played');
      await begin(); await tab.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      check(await tab.evaluate(() => window.micTracks.every(track => track.readyState === 'ended') && window.recordingCount === 0 && window.wakeRequests === window.wakeReleases), 'Page exit leaked resources');
      await tab.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await ready();
      check(await tab.evaluate(() => window.micCalls === 2 && window.recordingCount === 0 && window.micTracks[1].enabled), 'Resume did not automatically prepare');
      await tab.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); window.delayMicrophone = true; Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      await tab.waitForFunction(() => window.pendingMicrophones.length === 1);
      await tab.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); window.pendingMicrophones.shift()(); window.delayMicrophone = false; });
      await tab.waitForFunction(() => window.micStops === 3);
      check(await tab.evaluate(() => window.micTracks.every(track => track.readyState === 'ended') && window.recordingCount === 0), 'Late permission leaked');
      await tab.evaluate(() => { window.denyMicrophone = true; Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      await tab.waitForFunction(() => window.micCalls === 4);
      await tab.locator('#voice-open').filter({ hasText: locale === 'ko-KR' ? '음성 다시 준비' : 'Retry voice setup' }).waitFor();
      await tab.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
      await tab.waitForTimeout(150); check(await tab.evaluate(() => window.micCalls === 4), 'Permission denial retried automatically');
      await tab.evaluate(() => { window.denyMicrophone = false; }); await tab.locator('#voice-open').click(); await ready();
      check(await tab.evaluate(() => window.micCalls === 5 && window.recordingCount === 0 && window.micTracks.at(-1).enabled), 'Single tap did not prepare microphone');
      await tab.keyboard.press('Escape'); await tab.locator('#settings-button').click(); await tab.locator('#disconnect').click();
      await tab.waitForFunction(() => window.micStops === 4);
      check(await tab.evaluate(() => window.micTracks.every(track => track.readyState === 'ended') && window.recordingCount === 0 && window.wakeRequests === window.wakeReleases), 'Disconnect leaked resources');
      const modeTab = await context.newPage(); modeTab.on('pageerror', error => errors.push(error.message));
      await modeTab.goto(baseURL); await modeTab.waitForFunction(() => window.pendingMicrophones.length === 1);
      await modeTab.evaluate(() => { window.delayMicrophone = false; window.delayRecorderStart = false; window.pendingMicrophones.shift()(); window.finishModel(); });
      await modeTab.locator('#voice-open[data-ready="true"]').waitFor();
      await modeTab.locator('#settings-button').click(); await modeTab.locator('input[name="device-mode"][value="shared"]').check();
      await modeTab.waitForFunction(() => window.micStops === 1);
      check(await modeTab.evaluate(() => window.recordingCount === 0 && window.wakeRequests === window.wakeReleases), 'Mode change leaked resources');
      await modeTab.close();
      const unsupportedTab = await context.newPage(); unsupportedTab.on('pageerror', error => errors.push(error.message));
      await unsupportedTab.goto(baseURL + '?test-unsupported=1');
      await unsupportedTab.locator('#voice-open').filter({ hasText: locale === 'ko-KR' ? '음성 다시 준비' : 'Retry voice setup' }).waitFor();
      await unsupportedTab.locator('#voice-open').click();
      check(await unsupportedTab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '음성 준비 실패' : 'Voice setup failed'), 'Unsupported browser remains in indefinite preparation');
      check(await unsupportedTab.evaluate(() => window.micCalls === 0 && window.modelLoads === 0), 'Unsupported recognizer still acquired microphone');
      await unsupportedTab.close();
      check(uploads.length === 0 && playback.length === 3 && bridgeImports === 0 && errors.length === 0, 'Unexpected upload/playback/import/errors: ' + errors.join('; '));
      reports.push({ locale, playback: playback.length, uploads: uploads.length, startupBeforeSpotify: true, coldPressDoesNotQueue: true, repeatedHoldsRequests: 1, automaticResume: true, singleTapPermissionRetry: true, noHeldPreparation: true, errors });
    } finally { finishPlayer(); await context.close(); }
  }
  return reports;
}
