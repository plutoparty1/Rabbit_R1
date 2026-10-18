async ({ browser, baseURL = 'http://127.0.0.1:8792', screenshotDir = null }) => {
 const assert = (condition, message) => { if (!condition) throw new Error(message); };
 for (const locale of ['ko-KR', 'en-US']) {
  const receiver = await browser.newContext({ locale, viewport: { width: 240, height: 240 } });
  const sender = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
  const r1 = await receiver.newPage(), phone = await sender.newPage();
  const errors=[];r1.on('pageerror',e=>errors.push(e.message));phone.on('pageerror',e=>errors.push(e.message));
  try {
   await r1.goto(baseURL+'/'); await r1.locator('#settings-view').waitFor({state:'visible'});
   await r1.locator('#pair-start').click();
   await r1.locator('#pair-qr svg').waitFor();
   const code = (await r1.locator('#pair-code').textContent()).replace('-','');
   assert(/^[A-HJ-NP-Z2-9]{8}$/.test(code),'Expected 8-character code');
   assert(await r1.locator('#pair-qr svg path').count()===2,'QR not rendered');
   if(screenshotDir)await r1.screenshot({path:screenshotDir+'/pair-qr-'+locale+'.png'});
   await phone.goto(baseURL+'/pair.html#'+code);
   assert((await phone.locator('#pair-code-input').inputValue()).replace('-','')===code,'QR code not prefilled');
   assert(!phone.url().includes('#'),'Code fragment not removed');
   const id='b'.repeat(32);
   await phone.locator('#phone-client-id').fill(id); await phone.locator('#send-client-id').click();
   await phone.locator('#phone-success').waitFor({state:'visible'});
   assert(await phone.locator('#phone-client-id').inputValue()==='','Phone retains Client ID input');
   await r1.locator('#pair-confirm').waitFor({state:'visible',timeout:10000});
   assert(await r1.locator('#pair-suffix').textContent()==='bbbbbbbb','Receiver mismatch');
   assert(await r1.locator('#client-id').inputValue()==='','Applied before confirmation');
   if(locale==='en-US') {
    assert(await phone.locator('h1').textContent()==='Connect r1 with your phone','Phone not English');
    const text=await r1.locator('#pair-view').innerText();assert(!/[가-힣]/.test(text),'Receiver English contains Korean');
    const phoneText=await phone.locator('#phone-app').innerText();assert(!/[가-힣]/.test(phoneText),'Phone English contains Korean');
   }
   if(screenshotDir)await phone.screenshot({path:screenshotDir+'/pair-phone-'+locale+'.png',fullPage:true});
   await r1.locator('#pair-apply').click();
   await r1.locator('#settings-view').waitFor({state:'visible'});
   assert(await r1.locator('#client-id').inputValue()===id,'ID not applied');
   assert(await r1.evaluate(()=>localStorage.getItem('r1_spotify_personal_client_id'))===null,'Saved before explicit login');
   // Verify the retired code is unusable from a separate browser after acknowledgement.
   const response=await phone.evaluate(async({code,id})=>{const r=await fetch('./api/pair/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,clientId:id})});return r.status;},{code,id});
   assert(response===410,'Confirmed code remains usable');
   // Manual-code path works when scanning is unavailable.
   await r1.locator('#pair-start').click();await r1.locator('#pair-qr svg').waitFor();
   const nextCode=await r1.locator('#pair-code').textContent();
   await phone.goto(baseURL+'/pair.html');await phone.locator('#pair-code-input').fill(nextCode.toLowerCase());
   await phone.locator('#phone-client-id').fill('c'.repeat(32));await phone.locator('#send-client-id').click();
   await r1.locator('#pair-confirm').waitFor({state:'visible',timeout:10000});
   await r1.locator('#pair-back').click();
   assert(await r1.locator('#client-id').inputValue()===id,'Cancelled ID replaced the configured field');
   // Direct login still uses the chosen ID and a clean callback URL.
   await r1.route('https://accounts.spotify.com/authorize**',route=>route.fulfill({status:200,contentType:'text/html',body:'OAuth request reached'}));
   await r1.locator('#connect').click();await r1.waitForURL('https://accounts.spotify.com/authorize**');
   const oauth=new URL(r1.url());assert(oauth.searchParams.get('client_id')===id,'Wrong Client ID used in OAuth');
   assert(oauth.searchParams.get('redirect_uri')===baseURL+'/','Wrong OAuth redirect');
   assert(oauth.searchParams.get('code_challenge_method')==='S256','PKCE missing');
   assert(errors.length===0,errors.join('; '));
  } finally { await receiver.close();await sender.close(); }
 }
}
