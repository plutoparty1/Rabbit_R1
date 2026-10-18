// Playwright callback: validate real local WOFF2 responses and browser font loading.
async (page) => {
  const context = await page.context().browser().newContext({ locale: 'ko-KR', viewport: { width: 240, height: 282 } });
  const tab = await context.newPage();
  const external = [], failures = [];
  tab.on('request', request => { if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) external.push(request.url()); });
  tab.on('requestfailed', request => { if (request.url().includes('/fonts/')) failures.push(request.failure()?.errorText); });
  await tab.goto('http://127.0.0.1:8791/');
  const loaded = await tab.evaluate(async () => {
    await document.fonts.load('400 14px Inter', 'Spotify');
    await document.fonts.load('400 14px "Noto Sans KR"', '가사');
    await document.fonts.ready;
    return { latin: document.fonts.check('400 14px Inter', 'Spotify'), korean: document.fonts.check('400 14px "Noto Sans KR"', '가사'), family: getComputedStyle(document.documentElement).fontFamily };
  });
  if (!loaded.latin || !loaded.korean || !loaded.family.includes('Inter')) throw new Error('Font loading failed');
  if (external.length || failures.length) throw new Error('External or failed font request');
  const fontPath = await tab.evaluate(() => [...document.styleSheets[0].cssRules].find(rule => rule.cssText.includes('woff2')).style.src.match(/url\("?([^"\)]+)/)[1]);
  const response = await tab.request.get(new URL(fontPath, tab.url()).href);
  if (response.status() !== 200 || !response.headers()['content-type'].includes('font/woff2') || (await response.body()).subarray(0, 4).toString() !== 'wOF2') throw new Error('Invalid font asset response');
  await context.close();
};
