// Playwright callback using simulated native bridge/speech/microphone. No real device claims.
async (page, { baseURL = 'http://127.0.0.1:8791', screenshotDir } = {}) => {
  const context = await page.context().browser().newContext({ locale: 'ko-KR', viewport: { width: 240, height: 282 } });
  let localContext;
  const errors = [], external = [];
  const check = (value, message) => { if (!value) throw Error(message); };
  try {
    await context.addInitScript(() => {
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
      window.PluginMessageHandler = undefined;
    });
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('request', request => { if (!request.url().startsWith(baseURL + '/')) external.push(request.url()); });
    await tab.goto(baseURL + '/rabbit-test.html');
    await tab.locator('#capture-mode').selectOption('speech');
    await tab.locator('#speech-language').selectOption('ko-KR');
    await tab.locator('#rabbit-text').click();
    await tab.locator('#rabbit-status[data-state="unsupported"]').waitFor();
    // Bridge and Web Speech may be injected after the page was loaded.
    await tab.evaluate(() => {
      window.testSent = []; window.testStarts = 0; window.testStops = 0;
      window.PluginMessageHandler = { postMessage(value) {
        const payload = JSON.parse(value); window.testSent.push(payload);
        const request = JSON.parse(payload.message.split('Request: ')[1]);
        setTimeout(() => window.onPluginMessage({ data: JSON.stringify({ requestId: request.requestId, artist: '아이유', title: '밤편지', language: 'ko' }) }), 20);
      } };
      window.webkitSpeechRecognition = class {
        start() { window.testStarts++; setTimeout(() => { this.onstart?.(); this.onaudiostart?.(); this.onspeechstart?.(); }, 0); }
        stop() { const result = [{ transcript: '아이유의 밤편지 틀어줘' }]; result.isFinal = true;
          this.onresult?.({ results: [result], resultIndex: 0 }); this.onend?.(); }
        abort() { window.testStops++; }
      };
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        constructor(stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; }
        start() { this.state = 'recording'; this.onstart?.(); }
        stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: { size: 1234 } }); this.onstop?.(); }); }
      };
      window.micStops = 0;
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { window.micStops++; } }] }) } });
    });
    await tab.locator('#rabbit-text').click();
    await tab.locator('#rabbit-status[data-state="success"]').waitFor();
    check(await tab.locator('#rabbit-result').isVisible(), 'Rabbit response not shown');
    check(await tab.evaluate(() => testSent.length === 1 && testSent[0].useLLM && !testSent[0].wantsJournalEntry && !testSent[0].wantsR1Response), 'Wrong bridge flags');
    for (const height of [282, 240]) {
      await tab.setViewportSize({ width: 240, height });
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await tab.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('말씀해'));
      check((await tab.locator('#active-status').innerText()).startsWith('② 음성'), 'Active status is missing its stage');
      const dock = await tab.locator('#active-controls').boundingBox();
      check(dock.y >= 0 && dock.y + dock.height <= height + 1, 'Active controls clipped');
      check(await tab.evaluate(() => document.documentElement.scrollWidth === 240), 'Horizontal overflow');
      await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await tab.locator('#speech-status[data-state="success"]').waitFor();
    }
    check(await tab.locator('#transcript').inputValue() === '아이유의 밤편지 틀어줘', 'Wrong transcript');
    check(await tab.evaluate(() => testSent.length) === 1, 'Speech automatically sent to AI');
    await tab.locator('#rabbit-analyze').click();
    await tab.locator('#analysis-status[data-state="success"]').waitFor();
    check(await tab.locator('#summary').innerText().then(text => text.includes('확인했습니다')), 'Missing combined summary');
    await tab.locator('#copy-report').click();
    const reportText = await tab.locator('#report').inputValue(), report = JSON.parse(reportText);
    check(!reportText.includes('아이유') && !reportText.includes('밤편지') && !reportText.includes('틀어줘'), 'Report leaks spoken/model text');
    check(report.tests.rabbit.state === 'success' && report.tests.speech.state === 'success' && report.tests.analysis.state === 'success', 'Incorrect report statuses');
    check(report.tests.speech.eventCounts['started'] === 1 && report.tests.speech.eventCounts['audio-start'] === 1 && report.tests.speech.eventCounts['final-result'] === 1, 'Lifecycle events missing from safe report');
    check(report.inputCounts.hardware.longPressStart === 2 && report.inputCounts.screen.press === 0, 'Input sources mixed');
    // Microphone-only test must not invoke model and must release hardware tracks.
    await tab.locator('#capture-mode').selectOption('microphone');
    await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
    await tab.waitForFunction(() => document.querySelector('#active-status').textContent.includes('녹음 중'));
    await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
    await tab.waitForFunction(() => document.querySelector('#microphone-status').dataset.state === 'success');
    check(await tab.evaluate(() => micStops) === 1, 'Mic stream not stopped');
    check(await tab.evaluate(() => testSent.length) === 2, 'Microphone audio sent to AI');
    // Leaving while capturing must cancel, not submit or report success.
    await tab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
    await tab.waitForFunction(() => document.querySelector('#active-status').textContent.includes('녹음 중'));
    await tab.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await tab.locator('#active-controls').waitFor({ state: 'hidden' });
    check(await tab.evaluate(() => micStops) === 2, 'Page exit leaked microphone');
    check(await tab.evaluate(() => testSent.length) === 2, 'Page exit dispatched model');
    // Browser default is a default, never advertised as automatic language detection.
    await tab.locator('#speech-language').selectOption('');
    check((await tab.locator('#language-note').innerText()).includes('자동 언어 감지를 켜는 옵션이 아닙니다'), 'Misleading language default');
    // Actual r1 symptom: recognizer starts but never reports audio or a final sentence.
    await tab.clock.install();
    await tab.locator('#capture-mode').selectOption('speech');
    await tab.evaluate(() => {
      window.webkitSpeechRecognition = class {
        start() { this.onstart?.(); }
        stop() {}
        abort() {}
      };
      window.dispatchEvent(new Event('longPressStart'));
    });
    check((await tab.locator('#active-status').innerText()).startsWith('② 음성'), 'Listening state is not identified as stage 2');
    await tab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
    await tab.clock.runFor(8001);
    await tab.locator('#speech-status[data-state="timed-out"]').waitFor();
    const failedSpeech = await tab.locator('#speech-status').innerText();
    check(failedSpeech.startsWith('② 음성') && failedSpeech.includes('speech_result_timeout'), 'Speech wait failure has an ambiguous stage or code');
    check(await tab.locator('#rabbit-analyze').isDisabled(), 'Stage 3 enabled without final transcript');
    check((await tab.locator('#analysis-disabled-reason').innerText()).includes('아직 실행되지 않았습니다'), 'Missing stage 3 disabled explanation');
    const progress = await tab.locator('#speech-progress').innerText();
    check(progress.includes('인식 서비스 시작') && !progress.includes('마이크 입력') && !progress.includes('최종 문장'), 'Recognizer start was treated as microphone or transcript success');
    check(await tab.locator('#speech-guidance').isVisible(), 'No actionable timeout guidance');
    await tab.locator('#copy-report').click();
    const failureReport = JSON.parse(await tab.locator('#report').inputValue());
    check(failureReport.tests.speech.code === 'speech_result_timeout' && failureReport.tests.analysis.state === 'not-run', 'Failure report blames AI for missing speech');
    check(failureReport.tests.speech.eventCounts.started === 1 && !failureReport.tests.speech.eventCounts['audio-start'], 'Failure report invented microphone input');
    check(failureReport.tests.speech.timeline.every(item => Number.isFinite(item.elapsedMs) && !('text' in item)), 'Timeline is not safe or measurable');
    // A naturally ended recognizer with no final text is a no-speech error, not a timeout.
    await tab.evaluate(() => {
      window.webkitSpeechRecognition.prototype.stop = function () { this.onend?.(); };
      window.dispatchEvent(new Event('longPressStart'));
      window.dispatchEvent(new Event('longPressEnd'));
    });
    await tab.locator('#speech-status[data-state="error"]').waitFor();
    check((await tab.locator('#speech-status').innerText()).includes('[no_speech]'), 'Natural end was mislabeled as timeout');
    // Received but uncorrelated callbacks stay distinct from no response; raw payloads are redacted.
    await tab.evaluate(() => {
      window.PluginMessageHandler.postMessage = value => {
        window.testSent.push(JSON.parse(value));
        for (let i = 0; i < 15; i++) window.onPluginMessage({ data: { requestId: 'wrong-request', artist: 'secret-transcript-raw', title: 'secret-song', language: 'ko' } });
      };
    });
    await tab.locator('#rabbit-text').click();
    await tab.clock.runFor(45001);
    await tab.locator('#rabbit-status[data-state="timed-out"]').waitFor();
    const failedRabbit = await tab.locator('#rabbit-status').innerText();
    check(failedRabbit.startsWith('① 래빗 AI') && failedRabbit.includes('rabbit_unmatched_response') && failedRabbit.includes('도착'), 'Unmatched AI callback confused with no response');
    await tab.locator('#copy-report').click();
    const unmatchedText = await tab.locator('#report').inputValue(), unmatchedReport = JSON.parse(unmatchedText);
    check(unmatchedReport.tests.rabbit.eventCounts['callback-received'] === 15 && unmatchedReport.tests.rabbit.eventCounts['reply-unmatched'] === 15, 'AI callback counts incorrect');
    check(unmatchedReport.tests.rabbit.timeline.length === 20, 'Timeline not bounded to latest 20 events');
    check(!unmatchedText.includes('secret-') && !unmatchedText.includes('wrong-request') && !unmatchedText.includes('아이유'), 'Failure report exposes response contents');
    const stageSummary = await tab.locator('#stage-results').innerText();
    check(['① 래빗 AI', '② 음성', '② 마이크', '③ 문장 분석', 'rabbit_unmatched_response', 'no_speech'].every(label => stageSummary.includes(label)), 'Copy-free summary lacks stage results/codes');
    check((await tab.locator('.intro').innerText()).includes('20261025-r26-test'), 'Current version not visible near intro');
    if (screenshotDir) {
      await tab.setViewportSize({ width: 240, height: 282 });
      await tab.evaluate(() => window.scrollTo(0, 0));
      await tab.screenshot({ path: screenshotDir + '/rabbit-test-240x282.png' });
    }

    // Exercise the real LocalSpeechProbe and a real dedicated Worker. Only the
    // worker's model implementation, microphone, and audio decoder are simulated.
    localContext = await page.context().browser().newContext({ locale: 'ko-KR', viewport: { width: 240, height: 282 } });
    await localContext.route('**/local-asr-worker.mjs*', route => route.fulfill({
      contentType: 'text/javascript', body: `
        self.onmessage = ({ data }) => {
          const { id, type } = data;
          if (type === 'load') {
            setTimeout(() => self.postMessage({ id, type: 'progress', progress: { status: 'progress', loaded: 25, total: 100, progress: 25 } }), 180);
            setTimeout(() => self.postMessage({ id, type: 'ready' }), 500);
          } else if (type === 'transcribe') {
            if (!(data.audio instanceof Float32Array) || data.audio.length !== 16000 || data.language !== '') {
              self.postMessage({ id, type: 'error', code: 'invalid_audio' }); return;
            }
            if (!data.hold) setTimeout(() => self.postMessage({ id, type: 'result', text: '아이유의 밤편지 틀어줘', language: 'ko' }), 40);
          }
        };`,
    }));
    await localContext.addInitScript(() => {
      window.localCaptures = 0; window.localTrackStops = 0; window.localContextCloses = 0;
      window.localWorkers = []; window.localWorkerMessages = []; window.localTerminations = 0;
      window.localHoldTranscription = false; window.localSent = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) { super(url, options); window.localWorkers.push(this); }
        postMessage(data, transfer) {
          window.localWorkerMessages.push({ id: data.id, type: data.type, samples: data.audio?.length || 0, language: data.language });
          super.postMessage({ ...data, hold: window.localHoldTranscription }, transfer);
        }
        terminate() { window.localTerminations++; super.terminate(); }
      };
      window.AudioContext = class {
        decodeAudioData() { return Promise.resolve({ sampleRate: 48000, length: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(48000).fill(0.25) }); }
        close() { window.localContextCloses++; return Promise.resolve(); }
      };
      window.MediaRecorder = class {
        static isTypeSupported(type) { return type === 'audio/webm'; }
        constructor(stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(20262)], { type: 'audio/webm' }) }); this.onstop?.(); });
        }
      };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: async () => {
          window.localCaptures++;
          return { getTracks: () => [{ stop() { window.localTrackStops++; } }] };
        },
      } });
      window.PluginMessageHandler = { postMessage(value) {
        const payload = JSON.parse(value); window.localSent.push(payload);
        const request = JSON.parse(payload.message.split('Request: ')[1]);
        setTimeout(() => window.onPluginMessage({ data: JSON.stringify({ requestId: request.requestId, artist: '아이유', title: '밤편지', language: 'ko' }) }), 20);
      } };
    });
    const localTab = await localContext.newPage();
    localTab.on('pageerror', error => errors.push(error.message));
    localTab.on('request', request => { if (!request.url().startsWith(baseURL + '/')) external.push(request.url()); });
    await localTab.goto(baseURL + '/rabbit-test.html');
    check(await localTab.locator('#capture-mode').inputValue() === 'local', 'Local Whisper is not the default');
    check(await localTab.locator('#speech-language').inputValue() === '', 'Whisper automatic language detection is not the default');
    check(await localTab.locator('#capture-hold').isDisabled(), 'Recording enabled before local model preparation');
    check(await localTab.locator('#local-prepare').isEnabled(), 'Local preparation is unavailable');
    check(await localTab.evaluate(() => localCaptures === 0 && localWorkers.length === 0), 'Page load started model or microphone');
    await localTab.locator('#local-prepare').click();
    await localTab.waitForFunction(() => document.querySelector('#model-status').textContent.includes('25%'));
    check(await localTab.evaluate(() => localCaptures === 0 && localContextCloses === 0), 'Model preload opened microphone or audio context');
    check(await localTab.locator('#capture-hold').isDisabled(), 'Recording enabled during model download');
    await localTab.locator('#model-status[data-state="success"]').waitFor();
    check(await localTab.locator('#capture-hold').isEnabled(), 'Recording unavailable after local preparation');
    check((await localTab.locator('#local-prepare').innerText()).includes('준비 완료'), 'Ready state not visible');
    for (const height of [282, 240]) {
      await localTab.setViewportSize({ width: 240, height });
      await localTab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
      await localTab.waitForFunction(() => document.querySelector('#active-status').textContent.includes('녹음 중'));
      const dock = await localTab.locator('#active-controls').boundingBox();
      check(dock.y >= 0 && dock.y + dock.height <= height + 1, 'Local recording controls clipped');
      check(await localTab.evaluate(() => document.documentElement.scrollWidth === 240), 'Local mode has horizontal overflow');
      check(await localTab.locator('#capture-release').isVisible() && await localTab.locator('#cancel-test').isVisible(), 'Local recording controls not available');
      await localTab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
      await localTab.locator('#speech-status[data-state="success"]').waitFor();
      check(await localTab.locator('#transcript').inputValue() === '아이유의 밤편지 틀어줘', 'Local transcript not shown');
      check((await localTab.locator('#speech-status').innerText()).includes('언어 ko'), 'Detected language not shown');
      check(await localTab.locator('#rabbit-analyze').isEnabled(), 'Local transcript did not enable stage 3');
      check(await localTab.evaluate(() => localSent.length === 0), 'Local speech release automatically contacted Rabbit AI');
    }
    check(await localTab.evaluate(() => localTrackStops === 2 && localContextCloses === 2), 'Successful local capture did not release audio resources');
    await localTab.locator('#rabbit-analyze').click();
    await localTab.locator('#analysis-status[data-state="success"]').waitFor();
    check(await localTab.evaluate(() => localSent.length === 1), 'Explicit local analysis did not call Rabbit AI once');
    await localTab.locator('#copy-report').click();
    const localReportText = await localTab.locator('#report').inputValue(), localReport = JSON.parse(localReportText);
    check(localReport.capabilities.localWhisperReady === true && localReport.tests.model.state === 'success', 'Prepared local model absent from safe report');
    check(localReport.tests.speech.engine === 'local' && localReport.tests.speech.requestedLanguage === 'auto' && localReport.tests.speech.detectedLanguage === 'ko', 'Local report language metadata incorrect');
    check(localReport.tests.speech.eventCounts['local-recording'] === 1 && localReport.tests.speech.eventCounts['local-transcribing'] === 1 && localReport.tests.speech.eventCounts['local-result'] === 1, 'Local lifecycle signals missing');
    check(!localReportText.includes('아이유') && !localReportText.includes('밤편지') && !localReportText.includes('틀어줘'), 'Local report leaks transcript or AI contents');
    // Cancelling in-flight inference must actually terminate CPU work, invalidate
    // readiness, and require explicit preparation before recording again.
    await localTab.evaluate(() => { window.localHoldTranscription = true; window.dispatchEvent(new Event('longPressStart')); });
    await localTab.waitForFunction(() => document.querySelector('#active-status').textContent.includes('녹음 중'));
    await localTab.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
    await localTab.waitForFunction(() => window.localWorkerMessages.filter(message => message.type === 'transcribe').length === 3);
    await localTab.locator('#cancel-test').click();
    await localTab.locator('#active-controls').waitFor({ state: 'hidden' });
    check(await localTab.evaluate(() => localTerminations === 1 && localTrackStops === 3), 'Local inference cancellation leaked worker or microphone');
    check(await localTab.locator('#capture-hold').isDisabled() && await localTab.locator('#local-prepare').isEnabled(), 'Cancellation did not require model re-preparation');
    check(await localTab.locator('#rabbit-analyze').isDisabled(), 'Cancelled inference kept a stale transcript available');
    await localTab.locator('#copy-report').click();
    const cancelledLocal = JSON.parse(await localTab.locator('#report').inputValue());
    check(cancelledLocal.capabilities.localWhisperReady === false && cancelledLocal.tests.speech.code === 'cancelled', 'Safe report falsely claims local readiness after cancellation');
    await localTab.evaluate(() => { window.localHoldTranscription = false; });
    await localTab.locator('#local-prepare').click();
    await localTab.locator('#model-status[data-state="success"]').waitFor();
    await localTab.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
    await localTab.waitForFunction(() => document.querySelector('#active-status').textContent.includes('녹음 중'));
    await localTab.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await localTab.locator('#active-controls').waitFor({ state: 'hidden' });
    check(await localTab.evaluate(() => localTrackStops === 4 && localContextCloses === 4), 'Page exit leaked local recording resources');
    check(await localTab.evaluate(() => localSent.length === 1 && localWorkerMessages.filter(message => message.type === 'transcribe').length === 3), 'Page exit submitted cancelled local audio');
    if (screenshotDir) {
      await localTab.setViewportSize({ width: 240, height: 282 });
      await localTab.locator('#speech-title').scrollIntoViewIfNeeded();
      await localTab.screenshot({ path: screenshotDir + '/rabbit-local-test-240x282.png' });
    }
    check(errors.length === 0, 'Page errors: ' + errors.join('; '));
    check(external.length === 0, 'Unexpected external requests: ' + external.join('; '));
    return { passed: true, lateBridge: true, keylessStages: true, reportRedacted: true, microphoneReleased: true, stageTimeouts: true, speechEvidenceOnly: true, boundedTrace: true, unmatchedReply: true, localWhisper: true, localPreloadGated: true, localCancellation: true, viewports: ['240x282', '240x240'], externalRequests: external.length, realRabbit: false };
  } finally { await localContext?.close(); await context.close(); }
}
