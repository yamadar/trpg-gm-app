export async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let message;
    if (res.status === 401) message = 'ログインが必要です。右上からログインしてください。';
    else if (res.status === 429) message = '本日のAI利用上限に達しました。明日また遊べます。';
    else message = `API error ${res.status}: ${t.slice(0, 200)}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
