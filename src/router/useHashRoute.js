import { useEffect, useState } from 'react';

const USER_HASH_RE = /^#\/u\/([A-Za-z0-9._-]+)$/;

export function parseHash(hash) {
  const m = USER_HASH_RE.exec(hash || '');
  return { userId: m ? m[1] : null };
}

function notify() {
  window.dispatchEvent(new Event('hashchange'));
}

export function navigateToUser(userId) {
  window.location.hash = `#/u/${userId}`;
  notify(); // jsdom/一部環境ではhash代入がイベントを発火しないため明示的に通知
}

export function clearHash() {
  // pushState/replaceStateはhashchangeを発火しないため、除去後に手動通知する
  window.history.pushState(null, '', window.location.pathname + window.location.search);
  notify();
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
