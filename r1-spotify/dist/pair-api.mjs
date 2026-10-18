import { t } from './i18n.mjs?v=20261018-r21';

export async function pairRequest(action, input) {
  let response;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try { response = await fetch('./api/pair/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store', signal: controller.signal }); }
  catch { throw new Error(t('연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')); }
  finally { clearTimeout(timer); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      expired: '코드가 만료되었거나 취소되었습니다. r1에서 새 코드를 만들어 주세요.',
      used: '이미 전송한 코드입니다. r1에서 확인하거나 새 코드를 만들어 주세요.',
      rate: '요청이 많습니다. 10분 후 다시 시도해 주세요.',
      client_id: 'Client ID 32자리를 입력해 주세요.',
      input: '8자리 연결 코드와 Client ID를 확인해 주세요.',
      receiver: '이 기기의 연결 요청을 확인할 수 없습니다. 새 코드를 만들어 주세요.',
    };
    const error = new Error(t(messages[body.error] || '휴대폰 연결을 사용할 수 없습니다. 잠시 후 다시 시도하거나 직접 입력해 주세요.'));
    error.code = body.error;
    throw error;
  }
  return body;
}

export function normalizeCode(value) { return value.replace(/[-\s]/g, '').toUpperCase(); }
export function displayCode(value) { return value.slice(0, 4) + '-' + value.slice(4); }
