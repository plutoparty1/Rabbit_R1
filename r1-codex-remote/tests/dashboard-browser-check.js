// 실제 계정 값과 별도의 두 사용 창 모의 입력을 검증합니다. 세션 값은 생성하지 않습니다.
async (page) => {
  await page.setViewportSize({ width: 240, height: 282 });
  const initialStatus = await page.evaluate(async () => (await fetch('/api/state')).status);
  await page.getByRole('button', { name: '연결·시험', exact: true }).click();
  if (initialStatus !== 200) {
    const code = await page.getByRole('textbox', { name: 'PC 연결 코드' }).inputValue();
    if (code.length !== 8) throw new Error('시험 코드를 입력란에 준비해 주세요.');
    await page.getByRole('button', { name: '연결', exact: true }).click();
  }
  await page.waitForFunction(() => document.getElementById('network').textContent.includes('수신'));
  await page.getByRole('button', { name: '잔여 한도로 돌아가기' }).click();
  await page.waitForFunction(() => document.querySelector('#quota-windows .quota-number')?.textContent.includes('%'));
  const state = await page.evaluate(async () => (await (await fetch('/api/state')).json()));
  const shown = await page.locator('#quota-windows .quota-number').first().textContent();
  if (shown !== `${Math.round(state.quota.windows[0].remainingPercent * 10) / 10}%`) throw new Error('실제 계정 값과 화면 값이 다릅니다.');
  if (state.sessions !== null || state.codex.sameServerSameThreadProven) throw new Error('미검증 세션 상태가 성공으로 표시되었습니다.');
  if (await page.locator('#counts').isVisible()) throw new Error('홈에 진단 숫자가 보입니다.');
  await page.screenshot({ path: 'C:/Users/정산-PC/jjs1124/r1-codex-remote/docs/account-dashboard-240x282.png' });
  // 렌더링만 두 사용 창을 재현하며 실제 서비스 수치라고 기록하지 않습니다.
  await page.evaluate(async () => {
    const { renderState } = await import('/creation/app.mjs');
    renderState({ quota: { status: 'ready', windows: [
      { remainingPercent: 64, windowDurationMins: 300, resetsAt: 1791601842 },
      { remainingPercent: null, windowDurationMins: 10080, resetsAt: null },
    ], checkedAt: '2026-10-07T03:00:00Z' }, sessions: null });
  });
  const layout = await page.evaluate(() => {
    const home = document.getElementById('home').getBoundingClientRect();
    const quota = document.getElementById('quota-windows').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.quota-card')].map(node => node.getBoundingClientRect());
    return { homeBottom: home.bottom, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      cardOverflow: cards.some(card => card.bottom > quota.bottom), unknown: document.querySelectorAll('.quota-number')[1].textContent };
  });
  if (layout.homeBottom > layout.height || layout.horizontalOverflow || layout.cardOverflow) throw new Error(JSON.stringify(layout));
  if (layout.unknown !== '확인 불가') throw new Error('미제공 값이 숫자로 표시됩니다.');
  return { result: 'PASS', realAccountQuota: state.quota, layout, realR1Test: 'NOT_TESTED', sessionsVerified: false };
}
