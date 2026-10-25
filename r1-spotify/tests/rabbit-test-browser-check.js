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
        start() { window.testStarts++; setTimeout(() => this.onstart?.(), 0); }
        stop() { const result = [{ transcript: '아이유의 밤편지 틀어줘' }]; result.isFinal = true;
          this.onresult?.({ results: [result], resultIndex: 0 }); this.onend?.(); }
        abort() { window.testStops++; }
      };
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        constructor(stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; }
        start() { this.state = 'recording'; }
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
      await tab.waitForFunction(() => document.querySelector('#active-status').textContent.includes('말씀해'));
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
    if (screenshotDir) {
      await tab.setViewportSize({ width: 240, height: 282 });
      await tab.evaluate(() => window.scrollTo(0, 0));
      await tab.screenshot({ path: screenshotDir + '/rabbit-test-240x282.png' });
    }
    check(errors.length === 0, 'Page errors: ' + errors.join('; '));
    check(external.length === 0, 'Unexpected external requests: ' + external.join('; '));
    return { passed: true, lateBridge: true, keylessStages: true, reportRedacted: true, microphoneReleased: true, viewports: ['240x282', '240x240'], externalRequests: external.length, realRabbit: false };
  } finally { await context.close(); }
}
