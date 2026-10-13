// Playwright 도구에서 실행하는 UI 시험이며 음성과 마이크는 명시적으로 모의 처리합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 } });
  await context.addCookies(await page.context().cookies());
  page = await context.newPage();
  try {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 240, height: 282 });
  await page.context().addInitScript(() => {
    window.__testSpeechStarts = 0; window.__testSpeechStops = 0; window.__testSpeechAborts = 0;
    window.__testTracks = [];
    class TestRecognition {
      start() { window.__testSpeechStarts++; }
      stop() {
        window.__testSpeechStops++;
        queueMicrotask(() => {
          const results = [[{ transcript: '한국어 모의 인식 결과입니다.' }]];
          results[0].isFinal = true;
          this.onresult?.({ resultIndex: 0, results }); this.onend?.();
        });
      }
      abort() { window.__testSpeechAborts++; queueMicrotask(() => this.onend?.()); }
    }
    window.SpeechRecognition = TestRecognition;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
      window.__testTracks.push(track);
      return { getTracks: () => [track] };
    } });
    window.MediaRecorder = class {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/test'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => { this.ondataavailable?.({ data: { size: 128 } }); this.onstop?.(); });
      }
    };
  });
  await page.goto('http://127.0.0.1:8787/');
  await page.getByRole('button', { name: '연결·시험', exact: true }).click();
  // 실행 전에 화면에서 연결 코드를 입력합니다. 코드는 테스트 파일에 저장하지 않습니다.
  await page.waitForFunction(() => document.getElementById('network').textContent.includes('수신'));
  await page.getByRole('button', { name: '통신 시험', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('events').textContent.includes('PC 진단 왕복'));
  const button = page.getByRole('button', { name: '브라우저 시험: 누르고 말해 주세요.' });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('transcript').textContent === '한국어 모의 인식 결과입니다.');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('longPressStart'));
    window.dispatchEvent(new Event('longPressEnd'));
    window.dispatchEvent(new Event('sideClick'));
  });
  await page.waitForFunction(() => window.__testSpeechStops === 2);
  await page.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.waitForFunction(() => window.__testSpeechAborts === 1);
  await page.getByLabel('입력 시험 방식').selectOption('microphone');
  await page.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
  await page.waitForFunction(() => window.__testTracks.length === 1);
  await page.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
  await page.waitForFunction(() => window.__testTracks[0].readyState === 'ended');
  await page.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
  await page.waitForFunction(() => window.__testTracks.length === 2);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForFunction(() => window.__testTracks[1].readyState === 'ended');
  const state = await page.evaluate(async () => (await fetch('/api/state')).json());
  if (state.codex.sameServerSameThreadProven || state.codex.commandDeliveryEnabled) throw new Error('미증명 연결이 성공으로 표시되었습니다.');
  const results = await page.evaluate(() => ({ speechStarts: window.__testSpeechStarts, speechStops: window.__testSpeechStops,
    speechAborts: window.__testSpeechAborts, stoppedTracks: window.__testTracks.filter(t => t.readyState === 'ended').length,
    counts: document.getElementById('counts').textContent, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
  await page.getByRole('button', { name: '연결 해제', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('network').textContent.includes('해제'));
  if (await page.evaluate(async () => (await fetch('/api/state')).status) !== 401) throw new Error('연결 해제 후 접근이 차단되지 않았습니다.');
  if (errors.length || results.horizontalOverflow) throw new Error(JSON.stringify({ errors, results }));
  return { browserUi: 'PASS', realDevice: 'NOT_TESTED', realKoreanSpeech: 'NOT_TESTED', voiceAndMicrophone: 'SIMULATED',
    transport: 'REAL_LOCAL_HTTP_WS', sameServerSameThreadProven: false, results, errors };
  } finally { await context.close(); }
}
