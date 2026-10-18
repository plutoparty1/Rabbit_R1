import { t, getLocale, createStaticTranslator } from './i18n.mjs?v=20261018-r21';
import { pairRequest, normalizeCode } from './pair-api.mjs?v=20261018-r21';
createStaticTranslator(document)(getLocale());
const $ = id => document.getElementById(id);
// A QR carries only a short-lived code in the fragment, never a Client ID or token.
const code = normalizeCode(location.hash.slice(1));
if (/^[A-HJ-NP-Z2-9]{8}$/.test(code)) $('pair-code-input').value = code.slice(0, 4) + '-' + code.slice(4);
history.replaceState({}, '', location.pathname);
$('phone-redirect').value = new URL('./', location.href).href;
$('phone-copy-redirect').onclick = async () => {
  try { await navigator.clipboard.writeText($('phone-redirect').value); $('phone-message').textContent = t('복사했습니다.'); }
  catch { $('phone-redirect').focus(); $('phone-redirect').select(); $('phone-message').textContent = t('주소가 선택되었습니다. 브라우저의 복사 메뉴를 사용해 주세요.'); }
};
$('send-client-form').onsubmit = async event => {
  event.preventDefault();
  const code = normalizeCode($('pair-code-input').value), clientId = $('phone-client-id').value.trim();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) { $('phone-message').textContent = t('8자리 연결 코드를 확인해 주세요.'); $('pair-code-input').focus(); return; }
  if (!/^[a-f\d]{32}$/i.test(clientId)) { $('phone-message').textContent = t('Client ID 32자리를 입력해 주세요.'); $('phone-client-id').focus(); return; }
  $('send-client-id').disabled = true;
  try {
    const result = await pairRequest('submit', { code, clientId });
    $('phone-client-id').value = '';
    $('send-client-form').hidden = true;
    $('phone-success').hidden = false;
    $('phone-suffix').textContent = result.suffix;
    $('phone-message').textContent = '';
  } catch (error) { $('phone-message').textContent = error.message; }
  finally { $('send-client-id').disabled = false; }
};
