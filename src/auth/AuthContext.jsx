import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchMe, logout as apiLogout } from '../api/authClient.js';

export const AuthContext = createContext({
  user: null,
  loading: true,
  refresh: async () => {},
  updateUser: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // サーバー側の失敗に関わらずクライアントはログアウト状態にする
    }
    setUser(null);
  }, []);

  // PATCH /api/me が返した最新プロフィールを即座に全購読先へ配る。
  // 保存後に GET /api/me を挟むと、プロフィール画面など別stateを持つ表示が
  // 旧名のまま残る時間が生まれる。
  const updateUser = useCallback((updatedUser) => {
    setUser(updatedUser);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
