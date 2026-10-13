// r1과 같은 웹 API를 사용하여 실제 공개 HTTPS/WSS를 검증합니다. 음성은 시험하지 않습니다.
async (page) => {
  const root = 'C:/Users/정산-PC/jjs1124/r1-codex-remote';
  const origin = page.url().replace(/\/$/, '');
  const pairCode = await page.getByRole('textbox', { name: 'PC 연결 코드' }).inputValue();
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin) || !/^\d{8}$/.test(pairCode)) throw new Error('검증 주소와 일회성 연결 코드를 먼저 준비해 주세요.');
  await page.getByRole('textbox', { name: 'PC 연결 코드' }).fill('');
  const context = await page.context().browser().newContext({ ignoreHTTPSErrors: false, viewport: { width: 240, height: 282 } });
  try {
    // r1에서 확인된 미지원 API를 제거하여 실제 요청 경로의 호환성을 검증합니다.
    await context.addInitScript(() => {
      Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
    });
    const testPage = await context.newPage();
    const errors = [];
    testPage.on('pageerror', error => errors.push(error.message));
    const response = await testPage.goto(origin + '/');
    if (response.status() !== 200) throw new Error('HTTPS 화면 요청이 실패했습니다.');
    const status = await testPage.evaluate(async () => (await fetch('/api/state')).status);
    if (status !== 401) throw new Error('미등록 기기 접근이 차단되지 않았습니다.');
    await testPage.getByRole('button', { name: '연결·시험', exact: true }).click();
    await testPage.getByRole('textbox', { name: 'PC 연결 코드' }).fill(pairCode);
    await testPage.getByRole('button', { name: '연결', exact: true }).click();
    await testPage.waitForFunction(() => /WSS 수신|not a function/.test(document.getElementById('network').textContent));
    const networkMessage = await testPage.locator('#network').textContent();
    if (!networkMessage.includes('WSS 수신')) throw new Error(networkMessage);
    const started = Date.now();
    await testPage.getByRole('button', { name: '통신 시험', exact: true }).click();
    await testPage.waitForFunction(() => document.getElementById('events').textContent.includes('PC 진단 왕복'));
    const roundTripMs = Date.now() - started;
    const state = await testPage.evaluate(async () => (await (await fetch('/api/state')).json()));
    if (state.codex.sameServerSameThreadProven || state.codex.commandDeliveryEnabled) throw new Error('미증명 Codex 연결이 성공으로 표시되었습니다.');
    const blocked = await testPage.evaluate(async () => (await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '진단 차단 확인입니다.' }) })).status);
    if (blocked !== 409) throw new Error('Codex 명령 전송이 차단되지 않았습니다.');
    // 응답이 없는 요청도 8초 후 중단되고 안내되는지 확인합니다.
    await testPage.route('**/api/diagnostic/ping', () => {});
    const timeoutMs = await testPage.evaluate(async () => {
      const started = performance.now();
      const timeout = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (document.getElementById('network').textContent.includes('대기 시간이 초과')) {
            observer.disconnect(); resolve(Math.round(performance.now() - started));
          }
        });
        observer.observe(document.getElementById('network'), { childList: true });
      });
      document.getElementById('ping').click();
      return await timeout;
    });
    await testPage.unroute('**/api/diagnostic/ping');
    if (timeoutMs < 7000 || timeoutMs > 14000) throw new Error('요청 시간 제한이 유지되지 않았습니다.');
    const closeCode = await testPage.evaluate(async () => {
      const socket = new WebSocket(location.origin.replace('https://', 'wss://') + '/api/events');
      await new Promise((resolve, reject) => { socket.onmessage = resolve; socket.onerror = reject; });
      const closed = new Promise((resolve, reject) => { socket.onclose = event => resolve(event.code); setTimeout(() => reject(new Error('WSS 폐기 시간이 초과되었습니다.')), 5000); });
      await fetch('/api/unpair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return await closed;
    });
    if (closeCode !== 1008) throw new Error('폐기된 기기의 WSS가 차단되지 않았습니다.');
    const revoked = await testPage.evaluate(async () => (await fetch('/api/state')).status);
    if (revoked !== 401) throw new Error('폐기된 기기의 HTTPS가 차단되지 않았습니다.');
    if (errors.length) throw new Error(JSON.stringify(errors));
    await testPage.screenshot({ path: root + '/docs/public-browser-240x282.png' });
    const result = { checkedAt: new Date().toISOString(), url: origin, result: 'PASS',
      testEnvironment: 'PC_BROWSER_PUBLIC_NETWORK', realR1Test: 'NOT_TESTED', realKoreanStt: 'NOT_TESTED',
      missingBrowserApis: ['AbortSignal.timeout'],
      timeoutCancelled: true, timeoutMs,
      certificateVerification: 'BROWSER_DEFAULT', ignoreHTTPSErrors: false, httpsPage: response.status(), wssReceived: true,
      hostId: state.hostId, diagnosticRoundTripMs: roundTripMs, unpairedHttp: status,
      commandsBlocked: blocked, wrongOriginTest: 'separate-native-HTTPS-check', revokedHttp: revoked, revokedWssCloseCode: closeCode,
      sameServerSameThreadProven: false, commandDeliveryEnabled: false, errors };
    return result;
  } finally { await context.close(); }
}
