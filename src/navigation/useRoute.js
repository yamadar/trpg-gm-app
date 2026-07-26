import { useEffect, useState } from 'react';
import { parseRoute, buildHash } from './routes.js';

const HOME = { name: 'home' };

// jsdom や一部環境では hash 代入が hashchange を発火しないため明示的に通知する。
// (旧 useHashRoute.js と同じ理由)
function notify() {
  window.dispatchEvent(new Event('hashchange'));
}

function readRoute() {
  return parseRoute(window.location.hash) || HOME;
}

export function navigateHash(hash) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
  notify();
}

export function navigate(route) {
  navigateHash(buildHash(route));
}

export function replace(route) {
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', pathname + search + buildHash(route));
  notify();
}

export function useRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    // 購読開始までに hash が変わっていた場合に取りこぼさない。
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // 省略形・旧URL・解釈できない hash を正準形へ寄せる。履歴は積まない。
  // hash 無しのホームだけは、URL を汚さないためそのまま許容する。
  useEffect(() => {
    if (route.name === 'home' && window.location.hash === '') return;
    const canonical = buildHash(route);
    if (window.location.hash !== canonical) replace(route);
  }, [route]);

  return route;
}
