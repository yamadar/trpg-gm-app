export async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let message;
    if (res.status === 401) message = 'ログインが必要です。右上からログインしてください。';
    else if (res.status === 429) message = '本日のAI利用上限に達しました。明日また遊べます。';
    else if (res.status === 502 || res.status === 503) {
      message = 'サーバーが一時的に応答できません。少し時間をおいてから、もう一度お試しください。';
    }
    else message = `API error ${res.status}: ${t.slice(0, 200)}`;
    const err = new Error(message);
    err.status = res.status;
    // 呼び出し側が分岐に使えるよう、JSONのエラー本文はそのまま添える。
    // 文面の作り分けを message の文字列一致に頼らせないため。
    //
    // 添えるのは構造を持つ本文(オブジェクト/配列)だけ。JSON.parse は "boom" や 123 の
    // ような素の値も通してしまい、そのまま渡すと呼び出し側の err.body?.error が
    // 「本文はあるが期待の形ではない」場合と区別できなくなる。素の値は本文なしと同じ扱いにする。
    try {
      const parsed = JSON.parse(t);
      err.body = parsed !== null && typeof parsed === 'object' ? parsed : null;
    } catch {
      err.body = null;
    }
    throw err;
  }
  return res.json();
}
