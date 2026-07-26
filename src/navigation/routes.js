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

const NAV_TAB_KEYS = NAV_TABS.map((t) => t.key);
const LIBRARY_LABELS = Object.fromEntries(LIBRARY_TABS.map((t) => [t.key, t.label]));
const BROWSE_LABELS = Object.fromEntries(GALLERY_TABS.map((t) => [t.key, t.label]));
const RECORDS_LABELS = { endings: 'エンディング図鑑', achievements: '実績' };

const HOME_CRUMB = { key: 'home', label: 'ホーム', hash: '#/' };

// グローバルナビでハイライトすべきタブ。該当しない画面(集中モード・ユーザーページ)は null。
export function navTabFor(route) {
  if (!route) return null;
  return NAV_TAB_KEYS.includes(route.name) ? route.name : null;
}

// 集中モード = 1つのタスクを完遂する画面。グローバルナビを出さない。
export function isFocusRoute(route) {
  return !!route && (route.name === 'setup' || route.name === 'play');
}

// URL だけから決まるパンくずの段。末尾の動的ラベル(World名・公開アイテム名・表示名)は
// 画面側が BreadcrumbContext へ登録するため、ここには含めない。
export function crumbsFor(route) {
  if (!route) return [HOME_CRUMB];
  switch (route.name) {
    case 'library':
      return [
        HOME_CRUMB,
        { key: 'library', label: '素材', hash: '#/library/world' },
        {
          key: 'libraryTab',
          label: LIBRARY_LABELS[route.libraryTab],
          hash: `#/library/${route.libraryTab}`,
        },
      ];
    case 'browse':
      return [
        HOME_CRUMB,
        { key: 'browse', label: 'さがす', hash: '#/browse/starters' },
        {
          key: 'browseTab',
          label: BROWSE_LABELS[route.browseTab],
          hash: `#/browse/${route.browseTab}`,
        },
      ];
    case 'records':
      return [
        HOME_CRUMB,
        { key: 'records', label: '記録', hash: '#/records/endings' },
        {
          key: 'recordsTab',
          label: RECORDS_LABELS[route.recordsTab],
          hash: `#/records/${route.recordsTab}`,
        },
      ];
    case 'home':
    case 'user':
    default:
      return [HOME_CRUMB];
  }
}

// 末尾に動的ラベルの段を持つ route かどうか。false のときは登録待ちの空段を出さない。
export function wantsDynamicCrumb(route) {
  if (!route) return false;
  if (route.name === 'library') return !!route.worldId;
  if (route.name === 'browse') return !!route.publicId;
  return route.name === 'user';
}
