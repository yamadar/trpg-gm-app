import { LIBRARY_TABS, WORLD_SCOPED_LIBRARY_TABS } from '../constants/libraryTabs.js';
import { GALLERY_TABS, PUBLIC_TABS } from '../constants/publicContent.js';

export { LIBRARY_TABS };

const LIBRARY_TAB_KEYS = LIBRARY_TABS.map((t) => t.key);
const BROWSE_TAB_KEYS = GALLERY_TABS.map((t) => t.key);
const RECORDS_TAB_KEYS = ['endings', 'achievements'];
const USER_TAB_KEYS = PUBLIC_TABS.map((t) => t.key);
const DEFAULT_USER_TAB = 'novels';

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

  const [head, a, b, c] = segments;
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
    case 'u': {
      if (segments.length < 2 || segments.length > 4 || !isId(a)) return null;
      const userTab = USER_TAB_KEYS.includes(b) ? b : DEFAULT_USER_TAB;
      // PUBLIC_TABS は4つとも PublicItemList / PublicItemDetail に載るため、
      // browse の starters のような「詳細を持たないタブ」の例外はここには無い。
      return { name: 'user', userId: a, userTab, publicId: isId(c) ? c : null };
    }
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
      if (route.publicId) return `#/u/${route.userId}/${route.userTab}/${route.publicId}`;
      // 素の #/u/:userId は既に共有され得る公開URL。既定タブのときはこの形を正準形に保つ。
      return route.userTab && route.userTab !== DEFAULT_USER_TAB
        ? `#/u/${route.userId}/${route.userTab}`
        : `#/u/${route.userId}`;
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
const USER_LABELS = Object.fromEntries(PUBLIC_TABS.map((t) => [t.key, t.label]));

// パンくずの上位段はグローバルナビの項目そのもの。ラベルと遷移先が
// ナビバーと食い違わないよう NAV_TABS から引く。
const navCrumb = (key) => NAV_TABS.find((t) => t.key === key);

const HOME_CRUMB = navCrumb('home');

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
// 途中の段に動的ラベルが要る場合(ユーザーページのプロフィール段)は dynamicKey を
// 置き、Breadcrumb 側が同じキーで登録された名前を埋める(未登録の間はその段を出さない)。
export function crumbsFor(route) {
  if (!route) return [HOME_CRUMB];
  switch (route.name) {
    case 'library':
      return [
        HOME_CRUMB,
        navCrumb('library'),
        {
          key: 'libraryTab',
          label: LIBRARY_LABELS[route.libraryTab],
          hash: `#/library/${route.libraryTab}`,
        },
      ];
    case 'browse':
      return [
        HOME_CRUMB,
        navCrumb('browse'),
        {
          key: 'browseTab',
          label: BROWSE_LABELS[route.browseTab],
          hash: `#/browse/${route.browseTab}`,
        },
      ];
    case 'records':
      return [
        HOME_CRUMB,
        navCrumb('records'),
        {
          key: 'recordsTab',
          label: RECORDS_LABELS[route.recordsTab],
          hash: `#/records/${route.recordsTab}`,
        },
      ];
    // 一覧を見ている間は表示名そのものが末尾の段になるのでホームだけでよい。
    // 詳細を開いている間だけ「プロフィール › タブ」を上位段として挟み、
    // 末尾(公開アイテム名)から一覧へ戻れるようにする。
    case 'user':
      return route.publicId
        ? [
            HOME_CRUMB,
            { key: 'user', dynamicKey: 'user', hash: `#/u/${route.userId}` },
            {
              key: 'userTab',
              label: USER_LABELS[route.userTab],
              hash: buildHash({ name: 'user', userId: route.userId, userTab: route.userTab }),
            },
          ]
        : [HOME_CRUMB];
    case 'home':
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
