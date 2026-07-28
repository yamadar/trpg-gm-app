import { render } from '@testing-library/react';
import { AuthContext } from '../auth/AuthContext.jsx';

export function renderWithAuth(ui, { user = { id: 'usr_test', displayName: 'テスト', avatarUrl: null }, ...options } = {}) {
  return render(
    <AuthContext.Provider
      value={{ user, loading: false, refresh: async () => {}, updateUser: () => {}, logout: async () => {} }}
    >
      {ui}
    </AuthContext.Provider>,
    options
  );
}
