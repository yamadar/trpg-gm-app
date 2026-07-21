async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getCharacter(worldId, kind, name) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}/${name}`, { method: 'GET' });
}

export async function putCharacter(worldId, kind, name, { raw, revealed }) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, revealed }),
  });
}

export async function listCharacters(worldId, kind) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}`, { method: 'GET' });
}

export async function deleteCharacter(worldId, kind, name) {
  const res = await fetch(`/api/worlds/${worldId}/characters/${kind}/${name}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}

export async function putCharacterParsed(worldId, kind, name, { parsed, parsedHash }) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}/${name}/parsed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parsed, parsedHash }),
  });
}
