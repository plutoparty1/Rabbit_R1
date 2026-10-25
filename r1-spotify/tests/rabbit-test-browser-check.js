// Playwright callback using simulated native bridge/speech/microphone. No real device claims.
async (page, { baseURL = 'http://127.0.0.1:8791', screenshotDir } = {}) => {
  const context = await page.context().browser().newContext({ locale: 'ko-KR', viewport: { width: 240, height: 282 } });
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
    check((await tab.locator('.intro').innerText()).includes('20261025-r24-test'), 'Current version not visible near intro');
    if (screenshotDir) {
      await tab.setViewportSize({ width: 240, height: 282 });
      await tab.evaluate(() => window.scrollTo(0, 0));
      await tab.screenshot({ path: screenshotDir + '/rabbit-test-240x282.png' });
    }
    check(errors.length === 0, 'Page errors: ' + errors.join('; '));
    check(external.length === 0, 'Unexpected external requests: ' + external.join('; '));
    return { passed: true, lateBridge: true, keylessStages: true, reportRedacted: true, microphoneReleased: true, stageTimeouts: true, speechEvidenceOnly: true, boundedTrace: true, unmatchedReply: true, viewports: ['240x282', '240x240'], externalRequests: external.length, realRabbit: false };
  } finally { await context.close(); }
}
