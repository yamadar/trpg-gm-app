import { useEffect, useState } from 'react';

// テキストを一文字ずつ表示するためのhook。enabled=falseなら即時に全文表示。
// テキストは1エントリにつき不変である前提(Playのログエントリは追記のみ)。
// 一度全文まで進んだらenabledが後からfalseに変わっても巻き戻らない(countを保持)。
export function useTypewriter(text, { speedMs = 25, enabled = true } = {}) {
  const [count, setCount] = useState(enabled ? 0 : text.length);
  const done = count >= text.length;

  useEffect(() => {
    if (!enabled || done) return;
    const t = setInterval(() => setCount((c) => Math.min(c + 1, text.length)), speedMs);
    return () => clearInterval(t);
  }, [enabled, done, speedMs, text]);

  return { shown: text.slice(0, count), done, skip: () => setCount(text.length) };
}
