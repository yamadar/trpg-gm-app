export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function isValidId(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 128) return false;
  if (value.includes('..')) return false;
  if (value.startsWith('.')) return false;
  // allowlist: 英数字とドット・アンダースコア・ハイフンのみ許可(スラッシュ・空白・制御文字・#等を拒否)。makeId/slugifyの出力とsess_...idはこの集合に収まる。
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return false;
  return true;
}

export function idParamGuard(req, res, next, value) {
  if (!isValidId(value)) {
    res.status(400).json({ error: 'invalid path parameter' });
    return;
  }
  next();
}

export function kindParamGuard(req, res, next, value) {
  if (value !== 'pc' && value !== 'npc') {
    res.status(400).json({ error: 'invalid kind' });
    return;
  }
  next();
}
