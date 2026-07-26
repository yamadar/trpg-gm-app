import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

// パンくずの動的ラベル(World名・公開アイテム名・ユーザー表示名)の受け渡し口。
// シェル側で再取得すると二重フェッチになるため、既にデータを持っている画面から登録させる。
// 既定のキー 'dynamic' は末尾の段。ユーザーページのように途中の段にも名前が必要な画面が
// あるため、キーを指定して複数の段を同時に登録できる。
const BreadcrumbContext = createContext({ labels: {}, setLabel: () => {} });

export function BreadcrumbProvider({ children }) {
  const [labels, setLabels] = useState({});

  // value は関数更新も受ける(登録者による所有権チェックのため)。
  const setLabel = useCallback((key, value) => {
    setLabels((prev) => {
      const current = prev[key] ?? null;
      const next = (typeof value === 'function' ? value(current) : value) ?? null;
      if (current === next) return prev;
      const updated = { ...prev };
      if (next === null) delete updated[key];
      else updated[key] = next;
      return updated;
    });
  }, []);

  const value = useMemo(() => ({ labels, setLabel }), [labels, setLabel]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

// 画面から現在地の名前を登録する。アンマウント時に自動で解除するため、
// 画面遷移で前の画面のラベルが残らない。
export function useBreadcrumbLabel(label, key = 'dynamic') {
  const { setLabel } = useContext(BreadcrumbContext);
  useEffect(() => {
    const normalizedLabel = label ?? null;
    setLabel(key, normalizedLabel);
    // 後続の画面が先にマウントしてラベルを登録した後にこのクリーンアップが
    // 走るケースがあるため、自分が登録したラベルのままであるときだけ解除する。
    // 無条件にnullへ戻すと、後から来た画面のラベルまで消してしまう。
    return () => setLabel(key, (current) => (current === normalizedLabel ? null : current));
  }, [label, key, setLabel]);
}

export function useBreadcrumbTail() {
  return useContext(BreadcrumbContext).labels.dynamic ?? null;
}

export function useBreadcrumbLabels() {
  return useContext(BreadcrumbContext).labels;
}
