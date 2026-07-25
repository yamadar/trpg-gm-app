import { apiFetch } from './apiFetch.js';

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

export async function getIllustratedNovel(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novel/illustrated`, { method: 'GET' });
}

export async function listServerSessions() {
  return apiFetch('/api/sessions');
}

// 一覧画面が全セッションの小説化ジョブ状態を1リクエストで取得する。
export async function listNovelJobs() {
  return apiFetch('/api/novel-jobs');
}
