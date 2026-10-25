// Playwright callback; controlled microphone/model/Spotify responses, no real account or audio.
async (page, { baseURL = 'http://127.0.0.1:8791', screenshotDir } = {}) => {
  const browser = page.context().browser(), reports = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  for (const locale of ['ko-KR', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 240, height: 282 } });
    context.setDefaultTimeout(15000);
    const errors = [], playback = [], uploads = [], searches = [];
    let bridgeImports = 0, exact = true, finishPlayer, finishVerification, blockVerification = false, applyPlayback = true;
    const playerGate = new Promise(resolve => { finishPlayer = resolve; });
    const verificationGate = new Promise(resolve => { finishVerification = resolve; });
    const uri = 'spotify:track:' + 'a'.repeat(22);
    const albumUri = 'spotify:album:' + 'd'.repeat(22);
    const track = { uri, id: 'a'.repeat(22), name: '밤편지', type: 'track', duration_ms: 180000,
      artists: [{ name: '아이유' }], album: { uri: albumUri, name: 'Palette', images: [] } };
    const state = { is_playing: true, progress_ms: 0, actions: {}, device: { id: 'speaker', name: 'Living room', is_restricted: false }, item: track };
    try {
      await context.addInitScript(() => {
        sessionStorage.setItem('r1_spotify_device_mode', 'personal');
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
        window.modelLoads = 0; window.modelCancels = 0; window.cancelOptions = []; window.modelError = false; window.delayTranscription = false;
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
          constructor(options) { this.options = options; this.ready = false; this.draining = false; this.supported = !new URL(location.href).searchParams.has('test-unsupported'); window.mockRecognizer = this; }
          prepare() {
            if (this.ready) return Promise.resolve(); if (this.pending) return this.pending;
            window.modelLoads++; this.options.onState({ state: 'loading', progress: { status: 'progress', progress: 50 } });
            this.pending = new Promise((resolve, reject) => {
              window.finishModel = () => { this.ready = true; this.pending = null; this.options.onState({ state: 'ready' }); resolve(); };
              window.failModel = () => { this.ready = false; this.pending = null; this.options.onState({ state: 'error', code: 'model_load_failed' }); reject(Object.assign(new Error('load failed'), { code: 'model_load_failed' })); };
            }); return this.pending;
          }
          async transcribeBlob() {
            const job = { cancelled: false }; this.job = job;
            await this.prepare();
            if (this.draining) await this.inference;
            if (job.cancelled) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
            this.options.onState({ state: 'transcribing' });
            if (window.modelError) throw Object.assign(new Error('runtime detail'), { code: 'local_transcription_timeout' });
            if (window.delayTranscription) {
              this.inference = new Promise(resolve => { window.finishTranscription = resolve; });
              await this.inference; this.inference = null;
            }
            if (this.job === job) this.job = null;
            if (this.draining) { this.draining = false; this.options.onState({ state: 'ready' }); }
            if (job.cancelled) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
            return { transcript: window.testTranscript || '아이유의 밤편지 틀어줘', lang: 'ko' };
          }
          cancel(options) {
            window.modelCancels++; window.cancelOptions.push(options);
            if (this.job) { this.job.cancelled = true; this.job = null; }
            if (this.inference && !this.draining) { this.draining = true; this.options.onState({ state: 'draining' }); }
          }
          dispose() {}
        }
      ` }));
      await context.route('https://api.spotify.com/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/v1/search') { searches.push(url.searchParams.get('q')); return route.fulfill({ json: { tracks: { items: exact ? [track] : [track, { ...track, uri: 'spotify:track:' + 'b'.repeat(22) }] } } }); }
        if (request.method() !== 'GET') {
          const body = request.postDataJSON(); playback.push({ url: url.pathname, deviceId: url.searchParams.get('device_id'), body });
          if (applyPlayback && body?.uris?.[0]) { state.item = { ...track, uri: body.uris[0], id: body.uris[0].split(':').at(-1) }; state.is_playing = true; }
          if (body?.context_uri === albumUri && body?.offset?.uri) { state.item = { ...track, uri: body.offset.uri, id: body.offset.uri.split(':').at(-1) }; state.is_playing = true; }
          return route.fulfill({ status: 204, body: '' });
        }
        await playerGate;
        if (blockVerification && playback.length) await verificationGate;
        return route.fulfill({ json: state });
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
      await tab.locator('#voice-open[data-ready="true"]').waitFor();
      check(await tab.locator('#voice-open').innerText() === (locale === 'ko-KR' ? '노래 찾기' : 'Find a song'), 'Feature button lost its purpose during preparation');
      check(await tab.evaluate(() => !window.mockRecognizer.ready && window.modelLoads === 1), 'Cold recognizer was not still loading');
      check(await tab.evaluate(() => window.recordingCount === 0 && window.micTracks[0].enabled && window.vibrations.length === 0), 'Released cold input started later or standby source is not live');
      finishPlayer(); await tab.locator('#title').filter({ hasText: '밤편지' }).waitFor();
      const ready = () => tab.locator('#voice-open[data-ready="true"]').waitFor();
      const begin = async () => { await ready(); await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart'))); await tab.locator('#voice-panel[data-phase="recording"]').waitFor(); };
      const release = () => tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await begin();
      check(await tab.evaluate(() => window.micCalls === 1 && window.micTracks[0].enabled && window.recordingCount === 1 && window.vibrations.length === 1), 'First hold did not reuse prepared recorder');
      check(await tab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '듣는 중' : 'Listening'), 'Recording cue missing');
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
      check(await tab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '노래 검색 준비 중' : 'Preparing song search'), 'Post-release model wait is mislabeled as transcription');
      check(/50%/.test(await tab.locator('#voice-model-status').innerText()), 'Actual file download progress is missing');
      check(playback.length === 0 && searches.length === 0, 'Spotify request started before model readiness');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-recorded-loading-' + locale + '.png' });
      // Closing a recorded request must leave the first model preparation alive.
      await tab.keyboard.press('Escape'); await ready();
      check(await tab.evaluate(() => window.modelLoads === 1 && window.mockRecognizer.pending && window.cancelOptions.every(options => options?.preserveModel)), 'Closing cold request discarded model preparation');
      await begin(); await release();
      await tab.locator('#voice-panel[data-phase="transcribing"]').waitFor();
      await tab.evaluate(() => window.mockRecognizer.options.onState({ state: 'loading', progress: { status: 'done' } }));
      check((await tab.locator('#voice-model-status').innerText()).startsWith(locale === 'ko-KR' ? '인식기 실행 준비' : 'Starting recognizer'), 'Runtime initialization is mislabeled as a download');
      await tab.evaluate(() => window.finishModel());
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-processing-' + locale + '.png' });
      await tab.waitForFunction(() => Boolean(window.finishTranscription));
      check((await tab.locator('#voice-wait-status').innerText()).startsWith(locale === 'ko-KR' ? '음성을 글자로 변환' : 'Transcribing audio'), 'Transcription elapsed stage is missing');
      blockVerification = true;
      await tab.evaluate(() => { window.finishTranscription(); window.delayTranscription = false; });
      await tab.locator('#voice-panel[data-phase="verifying"]').waitFor();
      check(await tab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '노래 재생 확인 중' : 'Checking playback'), 'PUT 204 is shown as completed playback before verification');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-verifying-' + locale + '.png' });
      blockVerification = false; finishVerification();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 1 && playback[0].body.uris[0] === uri, 'First request failed');
      check((await tab.locator('#voice-instruction').innerText()).includes('Living room'), 'Confirmed device name is missing');
      await tab.locator('#voice-cancel').click(); await ready(); await tab.locator('#voice-open').click();
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-ready-' + locale + '.png' });
      if (locale === 'en-US') check(!/[가-힣]/.test(await tab.locator('#voice-panel').innerText()), 'Untranslated English UI');
      exact = false; await begin(); await release();
      await tab.locator('#voice-panel[data-phase="choosing"]').waitFor();
      check(playback.length === 1 && await tab.locator('#voice-results button').count() === 2, 'Ambiguous search did not offer candidates');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-candidates-' + locale + '.png' });
      state.device = { id: 'speaker-2', name: 'Bedroom speaker', is_restricted: false };
      await tab.locator('#voice-results button').nth(1).click(); await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback[1].deviceId === 'speaker-2' && (await tab.locator('#voice-instruction').innerText()).includes('Bedroom speaker'), 'Candidate click used a stale playback device');
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
      await ready();
      check(await tab.evaluate(() => window.mockRecognizer.ready && window.mockRecognizer.draining && window.modelLoads === 1), 'Cancel unloaded an initialized model');
      await begin(); await release();
      await tab.locator('#voice-panel[data-phase="transcribing"]').waitFor();
      check(await tab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '이전 요청 마무리 중' : 'Finishing the previous request'), 'Recorded request waiting for old inference is mislabeled as model reload');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-draining-' + locale + '.png' });
      await tab.keyboard.press('Escape');
      await tab.evaluate(() => { window.finishTranscription(); window.delayTranscription = false; });
      await tab.waitForFunction(() => !window.mockRecognizer.draining);
      check(playback.length === 3 && await tab.evaluate(() => window.modelCancels > 0 && window.modelLoads === 1 && window.cancelOptions.every(options => options?.preserveModel)), 'Cancelled recognition played or discarded its model');
      // A 204 response with the old song still playing must retain a retry candidate.
      applyPlayback = false; state.item = { ...track, uri: 'spotify:track:' + 'c'.repeat(22), id: 'c'.repeat(22) };
      await tab.evaluate(() => { window.testTranscript = ''; }); await begin(); await release();
      await tab.locator('#voice-panel[data-phase="choosing"][data-playback-error="true"]').waitFor();
      check(playback.length === 4 && await tab.locator('#voice-results button').count() === 1, 'Wrong-track 204 discarded its retry candidate or repeated PUT automatically');
      check(await tab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '재생을 확인하지 못했어요' : 'Playback not confirmed'), 'Wrong-track 204 is labeled as success');
      if (locale === 'en-US') check(!/[가-힣]/.test(await tab.locator('#voice-instruction').innerText()), 'Playback failure is untranslated');
      await tab.setViewportSize({ width: 240, height: 240 });
      await tab.locator('#voice-results button').scrollIntoViewIfNeeded();
      const retryBox = await tab.locator('#voice-results button').boundingBox(), retryContent = await tab.locator('#voice-content').boundingBox();
      check(await tab.locator('#voice-record').isHidden() && retryBox.y >= retryContent.y && retryBox.y + retryBox.height <= retryContent.y + retryContent.height + 1, 'Retry candidate is clipped by redundant controls: ' + JSON.stringify({ retryBox, retryContent }));
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-playback-retry-' + locale + '.png' });
      await tab.setViewportSize({ width: 240, height: 282 });
      applyPlayback = true; await tab.locator('#voice-results button').click();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 5 && playback[4].body.uris[0] === uri, 'Retained candidate did not retry playback');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-confirmed-' + locale + '.png' });
      // Album-context recovery is a separate, explicit user action after verification fails.
      applyPlayback = false;
      state.item = { ...track, uri: 'spotify:track:' + 'c'.repeat(22), id: 'c'.repeat(22), name: 'Other song' };
      state.device = { id: 'phone', name: 'My phone', type: 'Smartphone', is_restricted: false };
      await begin(); await release();
      await tab.locator('#voice-panel[data-phase="choosing"][data-playback-error="true"]').waitFor();
      check(playback.length === 6 && playback[5].deviceId === 'phone' && playback[5].body.uris[0] === uri && !playback[5].body.context_uri, 'Standard retry did not use the current phone or changed to album playback automatically');
      check(await tab.locator('#voice-instruction').innerText() === (locale === 'ko-KR' ? 'Spotify의 현재 곡이 선택한 곡과 다릅니다. 휴대폰의 Spotify에서 현재 곡을 확인해 주세요.' : 'Spotify is reporting a different song. Check the current song in Spotify on your phone.'), 'Playback mismatch is not described from the observed state');
      await tab.setViewportSize({ width: 240, height: 240 });
      await tab.locator('#voice-album-retry-button').scrollIntoViewIfNeeded();
      const albumBox = await tab.locator('#voice-album-retry-button').boundingBox(), albumContent = await tab.locator('#voice-content').boundingBox();
      check(await tab.locator('#voice-album-retry-button').isEnabled() && albumBox.y >= albumContent.y && albumBox.y + albumBox.height <= albumContent.y + albumContent.height, 'Manual album recovery is not reachable in a small viewport');
      check(await tab.locator('#voice-album-retry p').innerText() === (locale === 'ko-KR' ? '곡이 끝나면 앨범의 다음 곡이 이어질 수 있어요.' : 'The next song on the album may play after this one.'), 'Album continuation explanation is missing');
      if (screenshotDir) await tab.screenshot({ path: screenshotDir + '/voice-album-retry-' + locale + '.png' });
      await tab.locator('#voice-results button').scrollIntoViewIfNeeded();
      check(await tab.locator('#voice-results button').isEnabled(), 'Album option removed the original candidate retry');
      await tab.locator('#voice-album-retry-button').scrollIntoViewIfNeeded();
      await tab.locator('#voice-album-retry-button').click();
      await tab.locator('#voice-panel[data-phase="done"]').waitFor();
      check(playback.length === 7 && playback[6].deviceId === 'phone' && playback[6].body.context_uri === albumUri && playback[6].body.offset.uri === uri && !playback[6].body.uris, 'Manual album recovery did not send exactly one album request from the selected song');
      check((await tab.locator('#voice-instruction').innerText()).includes('My phone') && await tab.locator('#voice-album-retry').isHidden(), 'Album recovery success was not verified on the current phone');
      applyPlayback = true; await tab.setViewportSize({ width: 240, height: 282 });
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
      await tab.locator('#voice-open[data-ready="false"]').waitFor();
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
      const retryTab = await context.newPage(); retryTab.on('pageerror', error => errors.push(error.message));
      await retryTab.goto(baseURL); await retryTab.waitForFunction(() => window.pendingMicrophones.length === 1);
      await retryTab.evaluate(() => { window.delayMicrophone = false; window.delayRecorderStart = false; window.pendingMicrophones.shift()(); });
      await retryTab.locator('#voice-open[data-ready="true"]').waitFor(); await retryTab.locator('#voice-open').click();
      await retryTab.evaluate(() => window.failModel());
      await retryTab.locator('#voice-state').filter({ hasText: locale === 'ko-KR' ? '노래 검색 준비 실패' : 'Voice search setup failed' }).waitFor();
      check(await retryTab.locator('#voice-record').isEnabled() && await retryTab.locator('#voice-record').innerText() === (locale === 'ko-KR' ? '누르고 다시 시도' : 'Hold to retry'), 'Failed setup has no clear recording retry');
      await retryTab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await retryTab.locator('#voice-panel[data-phase="recording"]').waitFor();
      check(await retryTab.evaluate(() => Boolean(window.modelLoads === 2 && window.micCalls === 1 && window.mockRecognizer.pending)), 'Physical retry did not prepare model alongside recording');
      await retryTab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await retryTab.locator('#voice-panel[data-phase="transcribing"]').waitFor();
      await retryTab.keyboard.press('Escape'); await retryTab.evaluate(() => window.finishModel());
      await retryTab.locator('#voice-open[data-ready="true"]').waitFor();
      check(playback.length === 7, 'Cancelled preparation retry played'); await retryTab.close();
      const unsupportedTab = await context.newPage(); unsupportedTab.on('pageerror', error => errors.push(error.message));
      await unsupportedTab.goto(baseURL + '?test-unsupported=1');
      await unsupportedTab.waitForFunction(() => window.mockRecognizer?.supported === false);
      await unsupportedTab.locator('#voice-open').click();
      await unsupportedTab.locator('#voice-state').filter({ hasText: locale === 'ko-KR' ? '노래 검색 준비 실패' : 'Voice search setup failed' }).waitFor();
      check(await unsupportedTab.locator('#voice-state').innerText() === (locale === 'ko-KR' ? '노래 검색 준비 실패' : 'Voice search setup failed'), 'Unsupported browser remains in indefinite preparation');
      check(await unsupportedTab.evaluate(() => window.micCalls === 0 && window.modelLoads === 0), 'Unsupported recognizer still acquired microphone');
      await unsupportedTab.close();
      check(uploads.length === 0 && playback.length === 7 && bridgeImports === 0 && errors.length === 0, 'Unexpected upload/playback/import/errors: ' + errors.join('; '));
      reports.push({ locale, playback: playback.length, uploads: uploads.length, verifiedPlayback: true, wrongTrackRetry: true, manualAlbumRecovery: true, albumContinuationExplained: true, freshDeviceSelection: true, startupBeforeSpotify: true, coldPressDoesNotQueue: true, captureBeforeModelReady: true, closePreservesModelLoad: true, lateInferenceCannotPlay: true, repeatedHoldsRequests: 1, automaticResume: true, singleTapPermissionRetry: true, noHeldPreparation: true, errors });
    } finally { finishPlayer(); finishVerification(); await context.close(); }
  }
  return reports;
}
