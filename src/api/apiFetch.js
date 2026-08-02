const RETRY_MESSAGE =
  'サーバーが一時的に応答できません。少し時間をおいてから、もう一度お試しください。';
const AI_RATE_LIMIT_MESSAGE =
  'AIサービス側の利用枠に達しています。運営側での復旧後に、もう一度お試しください。';

function looksLikeHtml(text) {
  return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(text);
}

function parseErrorBody(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function createApiError(status, text) {
  const body = parseErrorBody(text);
  let message;
  if (status === 401) message = 'ログインが必要です。右上からログインしてください。';
  else if (status === 429 && body?.error === 'daily limit reached') {
    message = '本日のAI利用上限に達しました。明日また遊べます。';
  } else if (
    status === 429
    || ((status === 502 || status === 503) && body?.error === 'ai_service_rate_limited')
  ) {
    message = AI_RATE_LIMIT_MESSAGE;
  } else if (status === 502 || status === 503) message = RETRY_MESSAGE;
  // リバースプロキシなどが返すHTMLを画面のエラー文へ露出させない。
  else if (looksLikeHtml(text)) message = `API error ${status}`;
  else message = `API error ${status}: ${text.slice(0, 200)}`;

  const err = new Error(message);
  err.status = status;
  // 呼び出し側が分岐に使えるよう、JSONのエラー本文はそのまま添える。
  // 文面の作り分けを message の文字列一致に頼らせないため。
  //
  // 添えるのは構造を持つ本文(オブジェクト/配列)だけ。JSON.parse は "boom" や 123 の
  // ような素の値も通してしまい、そのまま渡すと呼び出し側の err.body?.error が
  // 「本文はあるが期待の形ではない」場合と区別できなくなる。素の値は本文なしと同じ扱いにする。
  err.body = body;
  return err;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch(url, options) {
  const normalizedOptions = options || {};
  const method = String(normalizedOptions.method || 'GET').toUpperCase();
  const requestOptions = MUTATING_METHODS.has(method)
    ? {
        ...normalizedOptions,
        headers: { ...(normalizedOptions.headers || {}), 'X-GMDesk-CSRF': '1' },
      }
    : options;
  const res = await fetch(url, requestOptions);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw createApiError(res.status, t);
  }
  if (res.status === 204) return undefined;
  return res.json();
}
