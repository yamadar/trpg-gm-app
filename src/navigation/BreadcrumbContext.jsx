import { createContext, useContext, useState, useEffect, useMemo } from 'react';

// パンくず末尾の動的ラベル(World名・公開アイテム名・ユーザー表示名)の受け渡し口。
// シェル側で再取得すると二重フェッチになるため、既にデータを持っている画面から登録させる。
const BreadcrumbContext = createContext({ label: null, setLabel: () => {} });

export function BreadcrumbProvider({ children }) {
  const [label, setLabel] = useState(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

// 画面から現在地の名前を登録する。アンマウント時に自動で解除するため、
// 画面遷移で前の画面のラベルが残らない。
export function useBreadcrumbLabel(label) {
  const { setLabel } = useContext(BreadcrumbContext);
  useEffect(() => {
    setLabel(label ?? null);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export function useBreadcrumbTail() {
  return useContext(BreadcrumbContext).label;
}
