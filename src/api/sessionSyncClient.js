async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function putSessionToServer(session) {
  return apiFetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

export async function novelizeSession(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novelize`, { method: 'POST' });
}

export async function getNovel(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novel`, { method: 'GET' });
}
