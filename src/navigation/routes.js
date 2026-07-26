import { LIBRARY_TABS, WORLD_SCOPED_LIBRARY_TABS } from '../constants/libraryTabs.js';
import { GALLERY_TABS } from '../constants/publicContent.js';

export { LIBRARY_TABS };

const LIBRARY_TAB_KEYS = LIBRARY_TABS.map((t) => t.key);
const BROWSE_TAB_KEYS = GALLERY_TABS.map((t) => t.key);
const RECORDS_TAB_KEYS = ['endings', 'achievements'];

const ID_RE = /^[A-Za-z0-9._-]+$/;

// '.' と '..' は ID_RE を通ってしまうがパストラバーサルに見えるため明示的に弾く。
function isId(s) {
  return typeof s === 'string' && s !== '.' && s !== '..' && ID_RE.test(s);
}

// グローバルナビの4項目。hash は各行き先の正準形を指す。
export const NAV_TABS = [
  { key: 'home', label: 'ホーム', hash: '#/' },
  { key: 'library', label: '素材', hash: '#/library/world' },
  { key: 'browse', label: 'さがす', hash: '#/browse/starters' },
  { key: 'records', label: '記録', hash: '#/records/endings' },
];

// hash を route オブジェクトへ変換する。解釈できないものは null を返し、
// 呼び出し側(useRoute)がホームへフォールバックする。
// 省略形(#/library)や旧URL(#/endings)もここで正準形の route に寄せるため、
// buildHash と往復させるだけで正規化とリダイレクトが同時に成立する。
export function parseRoute(hash) {
  const segments = String(hash || '')
    .replace(/^#/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length === 0) return { name: 'home' };

  const [head, a, b] = segments;
  switch (head) {
    case 'library': {
      if (segments.length > 3) return null;
      const libraryTab = LIBRARY_TAB_KEYS.includes(a) ? a : 'world';
      const worldScoped = WORLD_SCOPED_LIBRARY_TABS.includes(libraryTab);
      return { name: 'library', libraryTab, worldId: worldScoped && isId(b) ? b : null };
    }
    case 'browse': {
      if (segments.length > 3) return null;
      const browseTab = BROWSE_TAB_KEYS.includes(a) ? a : 'starters';
      // starters はパック一括取り込みの単位で /api/public/:type の対象外のため詳細を持たない。
      const hasDetail = browseTab !== 'starters';
      return { name: 'browse', browseTab, publicId: hasDetail && isId(b) ? b : null };
    }
    case 'records': {
      if (segments.length > 2) return null;
      return { name: 'records', recordsTab: RECORDS_TAB_KEYS.includes(a) ? a : 'endings' };
    }
    // 旧URL。ブックマーク済みの可能性があるため records 配下へ読み替える。
    case 'endings':
      return segments.length === 1 ? { name: 'records', recordsTab: 'endings' } : null;
    case 'achievements':
      return segments.length === 1 ? { name: 'records', recordsTab: 'achievements' } : null;
    case 'u':
      return segments.length === 2 && isId(a) ? { name: 'user', userId: a } : null;
    case 'setup':
      return segments.length === 1 ? { name: 'setup' } : null;
    case 'play':
      return segments.length === 2 && isId(a) ? { name: 'play', sessionId: a } : null;
    default:
      return null;
  }
}

export function buildHash(route) {
  if (!route) return '#/';
  switch (route.name) {
    case 'library':
      return route.worldId
        ? `#/library/${route.libraryTab}/${route.worldId}`
        : `#/library/${route.libraryTab}`;
    case 'browse':
      return route.publicId
        ? `#/browse/${route.browseTab}/${route.publicId}`
        : `#/browse/${route.browseTab}`;
    case 'records':
      return `#/records/${route.recordsTab}`;
    case 'user':
      return `#/u/${route.userId}`;
    case 'setup':
      return '#/setup';
    case 'play':
      return `#/play/${route.sessionId}`;
    case 'home':
    default:
      return '#/';
  }
}
