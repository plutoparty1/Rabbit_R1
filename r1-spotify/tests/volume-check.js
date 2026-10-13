// 래빗 휠의 볼륨 제어와 기존 가사·설정 탐색을 모의 Spotify 응답으로 검증합니다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 240, height: 282 }, reducedMotion: 'reduce' });
  const requests = [], errors = [];
  let delay = false, rejectVolume = false, active = 0, maximumActive = 0, refreshCount = 0;
  const current = { is_playing: true, progress_ms: 1000, device: { id: 'volume-device', is_restricted: false, supports_volume: true, volume_percent: 50 },
    item: { type: 'track', id: 'volume-track', name: '볼륨 검증 곡', duration_ms: 180000, artists: [{ name: '시험 가수' }], album: { name: '시험 앨범', images: [] } } };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wheel = async (event, count = 1) => page.evaluate(({ event, count }) => { for (let index = 0; index < count; index++) dispatchEvent(new Event(event)); }, { event, count });
  const refresh = async () => {
    // 고정 대기 시간 대신 새 응답이 화면에 반영된 시점을 확인합니다.
    current.item.name = `볼륨 검증 곡 ${++refreshCount}`;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(title => document.querySelector('#title').textContent === title, current.item.name);
  };
  const waitVolume = async volume => {
    try {
      await page.waitForFunction(volume => document.querySelector('#status').textContent === `볼륨 ${volume}%`, volume, { timeout: 5000 });
    } catch {
      throw new Error(`볼륨 ${volume}% 대기 실패: ${await page.locator('#status').textContent()} / 요청 ${JSON.stringify(requests)}`);
    }
    check(requests.at(-1)?.volume === volume, '요청한 볼륨이 반영되지 않았습니다: ' + JSON.stringify({ expected: volume, requests }));
  };
  try {
    await context.addInitScript(() => sessionStorage.setItem('r1_spotify_tokens_v1', JSON.stringify({ access_token: 'volume-test', refresh_token: 'volume-refresh', clientId: 'a'.repeat(32), expiresAt: Date.now() + 3600000 })));
    await context.route('https://api.spotify.com/**', async route => {
      if (route.request().url().includes('/volume?')) {
        const request = await page.evaluate(url => { const query = new URL(url).searchParams; return { volume: Number(query.get('volume_percent')), device: query.get('device_id') }; }, route.request().url());
        requests.push(request); active++; maximumActive = Math.max(maximumActive, active);
        if (delay) await page.waitForTimeout(300);
        active--;
        if (rejectVolume) return route.fulfill({ status: 403, json: {} });
        current.device.volume_percent = request.volume;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fulfill({ json: current });
    });
    await context.route('**/api/lyrics/bugs?**', route => route.fulfill({ status: 404, json: {} }));
    await context.route('https://lrclib.net/**', route => route.fulfill({ json: { plainLyrics: Array.from({ length: 30 }, (_, index) => `시험 가사 ${index + 1}`).join('\n') } }));
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8791/'); await page.locator('#title').filter({ hasText: '볼륨 검증 곡' }).waitFor();
    await wheel('scrollUp'); await waitVolume(55);
    await wheel('scrollDown'); await waitVolume(50);
    const beforeBurst = requests.length;
    await wheel('scrollUp', 3); await waitVolume(65);
    check(requests.length === beforeBurst + 1, '연속 휠 입력이 너무 많은 요청으로 전송되었습니다.');
    check(requests.every(request => request.device === 'volume-device'), '현재 재생 기기가 아닌 기기에 볼륨이 전송되었습니다.');
    // 처리 중 들어온 다음 입력도 마지막 목표 볼륨부터 계산하고 순서대로 전송합니다.
    delay = true; const beforeSlow = requests.length;
    await wheel('scrollUp');
    while (requests.length === beforeSlow) await page.waitForTimeout(25);
    await wheel('scrollUp', 2); await waitVolume(80); delay = false;
    check(maximumActive === 1, '볼륨 요청이 동시에 전송되어 적용 순서가 뒤바뀔 수 있습니다.');
    current.device.volume_percent = 97; await refresh(); await wheel('scrollUp', 4); await waitVolume(100);
    const atMaximum = requests.length; await wheel('scrollUp'); await page.waitForTimeout(250);
    check(requests.length === atMaximum, '최대 볼륨에서 불필요한 요청이 전송되었습니다.');
    current.device.volume_percent = 2; await refresh(); await wheel('scrollDown', 4); await waitVolume(0);
    // 대기 중 재생 기기가 바뀌면 이전 볼륨 목표를 새 기기에 적용하지 않습니다.
    const beforeDeviceChange = requests.length;
    await wheel('scrollUp'); current.device.id = 'second-volume-device'; current.device.volume_percent = 30;
    await refresh(); await page.waitForTimeout(200);
    check(requests.length === beforeDeviceChange, '기기가 바뀐 뒤 이전 볼륨 입력이 전송되었습니다.');
    // 가사와 설정에서는 원래의 스크롤 동작만 사용합니다.
    const beforeNavigation = requests.length;
    // 같은 순간에 가사로 이동하면 아직 전송하지 않은 플레이어 휠 입력은 취소합니다.
    await page.evaluate(() => { dispatchEvent(new Event('scrollUp')); document.getElementById('art-button').click(); });
    await page.locator('#lyrics-lines.plain').waitFor(); await wheel('scrollDown', 2);
    await page.waitForTimeout(200);
    check(await page.locator('#lyrics-lines').evaluate(element => element.scrollTop > 0), '가사 휠 탐색이 중단되었습니다.');
    await page.keyboard.press('Escape'); await page.locator('#settings-button').click(); await wheel('scrollDown', 2);
    check(await page.locator('#settings-view').evaluate(element => element.scrollTop > 0), '설정 휠 탐색이 중단되었습니다.');
    check(requests.length === beforeNavigation, '가사 또는 설정 화면에서 볼륨이 변경되었습니다.');
    await page.locator('#settings-back').click();
    current.device.supports_volume = false; await refresh(); await wheel('scrollUp'); await page.waitForTimeout(250);
    check(requests.length === beforeNavigation, '볼륨 조절 미지원 기기에 명령이 전송되었습니다.');
    check((await page.locator('#status').getAttribute('title')).includes('볼륨 조절을 사용할 수 없습니다.'), '미지원 기기 안내가 표시되지 않았습니다.');
    current.device.supports_volume = true; rejectVolume = true; await refresh(); await wheel('scrollUp');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('조작을 완료하지 못했습니다.'));
    const afterError = requests.length; await page.waitForTimeout(400);
    check(requests.length === afterError, '실패한 볼륨 명령을 자동으로 재전송했습니다.');
    check(errors.length === 0, errors.join('\n'));
    return { passed: true, upDown: true, step: 5, burstAccumulation: true, serialized: maximumActive === 1, boundaries: [0, 100], navigationPreserved: true,
      unsupportedDevice: true, deviceChangeCancelsPending: true, navigationCancelsPending: true, noBlindRetry: true,
      requests: requests.map(request => request.volume), errors, realSpotify: false, realRabbit: false };
  } finally { await context.close(); }
}
