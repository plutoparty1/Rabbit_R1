import { t } from './i18n.mjs?v=20261018-r21';
import { pairRequest, displayCode } from './pair-api.mjs?v=20261018-r21';
import qrcode from './qrcode.mjs';

export function setupPairing({ show, apply }) {
  const $ = id => document.getElementById(id);
  let session = null, timer, generation = 0, pending = '';
  function message(text) { $('pair-message').textContent = text; }
  async function cancel() {
    generation++; clearTimeout(timer); pending = '';
    const previous = session; session = null;
    if (previous) await pairRequest('cancel', { code: previous.code, secret: previous.secret }).catch(() => {});
  }
  function drawQr(text) {
    const qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
    const n = qr.getModuleCount(), ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${n + 8} ${n + 8}`);
    svg.setAttribute('aria-label', t('휴대폰으로 스캔할 연결 QR')); svg.setAttribute('role', 'img');
    const background = document.createElementNS(ns, 'path'); background.setAttribute('d', `M0 0h${n + 8}v${n + 8}H0z`); background.setAttribute('fill', '#fff'); svg.append(background);
    const path = document.createElementNS(ns, 'path'); let data = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) data += `M${x + 4} ${y + 4}h1v1h-1z`;
    path.setAttribute('d', data); path.setAttribute('fill', '#000'); svg.append(path); $('pair-qr').replaceChildren(svg);
  }
  async function poll(current) {
    if (!session || current !== generation) return;
    if (Date.now() >= session.expiresAt) { await cancel(); message(t('코드가 만료되었거나 취소되었습니다. r1에서 새 코드를 만들어 주세요.')); return; }
    if (!document.hidden) {
      try {
        const result = await pairRequest('poll', { code: session.code, secret: session.secret });
        if (current !== generation || !session) return;
        if (result.state === 'ready') {
          pending = result.clientId;
          $('pair-awaiting').hidden = true; $('pair-confirm').hidden = false;
          $('pair-suffix').textContent = pending.slice(-8);
          message(''); return;
        }
        message(t('휴대폰에서 Client ID를 보내 주세요.'));
      } catch (error) {
        if (current !== generation) return;
        message(error.message);
        if (['expired', 'receiver'].includes(error.code)) { await cancel(); return; }
      }
    }
    timer = setTimeout(() => poll(current), 3000);
  }
  async function start() {
    $('pair-start').disabled = true; $('pair-new').disabled = true;
    await cancel(); const current = generation;
    show('pair'); $('pair-awaiting').hidden = false; $('pair-confirm').hidden = true;
    $('pair-code').textContent = ''; $('pair-qr').replaceChildren();
    message(t('연결 코드를 만들고 있습니다.'));
    try {
      const created = await pairRequest('start', {});
      if (current !== generation) { await pairRequest('cancel', { code: created.code, secret: created.secret }).catch(() => {}); return; }
      session = created;
      const phone = new URL('./pair.html', location.href); phone.hash = created.code;
      drawQr(phone.href);
      $('pair-code').textContent = displayCode(created.code);
      $('pair-phone-link').href = new URL('./pair.html', location.href).href;
      $('pair-phone-link').textContent = new URL('./pair.html', location.href).href;
      await poll(current);
    } catch (error) { if (current === generation) message(error.message); }
    finally { $('pair-start').disabled = false; $('pair-new').disabled = false; }
  }
  $('pair-start').onclick = start;
  $('pair-new').onclick = start;
  $('pair-back').onclick = () => { cancel(); show('settings'); };
  $('pair-apply').onclick = async () => {
    if (!pending || !session || Date.now() >= session.expiresAt) { message(t('코드가 만료되었거나 취소되었습니다. r1에서 새 코드를 만들어 주세요.')); return; }
    const id = pending; await cancel(); apply(id); show('settings');
  };
  window.addEventListener('pagehide', () => { generation++; clearTimeout(timer); session = null; pending = ''; });
  return { cancel };
}
