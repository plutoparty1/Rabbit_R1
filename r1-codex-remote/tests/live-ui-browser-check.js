// 모의 상태로 화면 조작만 검증합니다. 실제 Codex·r1 연결 증거로 사용하지 않습니다.
async (page) => {
  const origin = page.url().replace(/\/$/, '');
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 } });
  try {
    const test = await context.newPage();
    const errors = [];
    test.on('pageerror', error => errors.push(error.message));
    await test.goto(origin);
    await test.evaluate(async () => {
      const { renderState } = await import('/creation/app.mjs');
      const sessions = Array.from({ length: 4 }, (_, i) => ({ id: `test-${i}`, name: `시험 세션 ${i + 1}`, status: '처리 중', reply: '<script>실행되지 않는 본문</script>' }));
      window.testState = { sessions, quota: { status: 'ready', windows: [{ remainingPercent: 73, windowDurationMins: 10080, resetsAt: null }] } };
      renderState(window.testState);
      window.dispatchEvent(new Event('scrollDown'));
    });
    const scrollTop = await test.locator('.session-overview').evaluate(node => node.scrollTop);
    if (scrollTop <= 0) throw new Error('홈의 휠 이벤트로 세션 목록을 넘길 수 없습니다.');
    await test.getByRole('button', { name: '시험 세션 4 처리 중', exact: true }).click();
    if (await test.locator('#response-text').textContent() !== '<script>실행되지 않는 본문</script>') throw new Error('응답 본문이 안전하게 표시되지 않습니다.');
    await test.evaluate(async () => {
      const { renderState } = await import('/creation/app.mjs');
      window.testState.sessions[3].reply = '새 응답이 도착했습니다.';
      window.testState.sessions[3].status = '응답 완료';
      renderState(window.testState);
    });
    if (await test.locator('#response-text').textContent() !== '새 응답이 도착했습니다.') throw new Error('한도 값이 같을 때 새 응답이 갱신되지 않습니다.');
    if (await test.locator('#response-status').textContent() !== '응답 완료') throw new Error('완료 상태가 갱신되지 않습니다.');
    if (await test.locator('#diagnostic').isVisible()) throw new Error('응답 화면에 진단 정보가 표시됩니다.');
    if (await test.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('화면이 가로로 넘칩니다.');
    await test.getByRole('button', { name: '잔여 한도로 돌아가기', exact: true }).click();
    if (await test.locator('#quota-windows .quota-number').textContent() !== '73%') throw new Error('홈의 한도 값이 변경되었습니다.');
    if (errors.length) throw new Error(errors.join('\n'));
    return { result: 'PASS', scope: 'mock_browser_ui', wheelList: true, responseUpdate: true, errors, realR1Test: 'NOT_TESTED', originalThreadVerified: false };
  } finally {
    await context.close();
  }
}
