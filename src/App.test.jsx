import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import App from './App.jsx';
import { navigate } from './navigation/useRoute.js';
import * as shareClient from './api/shareClient.js';
import * as starterClient from './api/starterClient.js';

afterEach(() => {
  window.location.hash = '';
});

// シェルのヘッダーは全画面で "GM's Desk" ボタンを出すため、その文字列だけでは
// ホームに居ることを示せない。ホーム本文の見出し(h1)で判定する。
const findHome = () => screen.findByRole('heading', { name: "GM's Desk" });
const queryHome = () => screen.queryByRole('heading', { name: "GM's Desk" });

describe('App', () => {
  it('shows the home screen after the initial storage check completes', async () => {
    render(<App />);
    expect(await findHome()).toBeInTheDocument();
    expect(screen.getByText('+ 新規プレイ')).toBeInTheDocument();
  });

  it('navigates to the library through the global nav and back home', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    render(<App />);
    await findHome();

    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    await waitFor(() => expect(window.location.hash).toBe('#/library/world'));
    expect(await screen.findByText('World一覧')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ホーム' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(await findHome()).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('navigates to the public gallery without requiring login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: null }) });
        }
        if (String(url).includes('/api/public/')) {
          return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, hasMore: false }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    render(<App />);
    await findHome();

    fireEvent.click(screen.getByRole('button', { name: 'さがす' }));
    await waitFor(() => expect(window.location.hash).toBe('#/browse/starters'));

    // タブ切り替えがURLに乗るのはGalleryをroute駆動にするTask 12から。ここでは
    // 未ログインのまま公開一覧を見られること(画面内タブ切り替え)だけを確かめる。
    fireEvent.click(await screen.findByText('小説'));
    expect(await screen.findByText('まだ公開されたものがありません')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('keeps the global nav visible on every browsing screen', async () => {
    render(<App />);
    await findHome();
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '記録' }));
    await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
  });

  it('shows an auth error banner when the URL has auth_error=1 and strips the query param', async () => {
    window.history.pushState({}, '', '/?auth_error=1');
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByText('ログインに失敗しました。もう一度お試しください。')
      ).toBeInTheDocument()
    );
    expect(window.location.search).toBe('');

    window.history.pushState({}, '', '/');
  });

  it('renders UserPage when the hash matches #/u/{userId}, keeping AuthBar visible', async () => {
    window.location.hash = '#/u/usr_x';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ user: null }) }))
    );
    const profileSpy = vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_x',
      displayName: 'Xavier',
      avatarUrl: null,
      bio: '',
    });
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Xavier')).toBeInTheDocument());
    expect(profileSpy).toHaveBeenCalledWith('usr_x');
    expect(listSpy).toHaveBeenCalledWith('novels', expect.objectContaining({ ownerId: 'usr_x' }));
    expect(screen.getByText('ログイン')).toBeInTheDocument();
    // ユーザーページもシェルの中に入ったので、ホーム本文には差し替わらないが
    // グローバルナビは出たままになる(以前はページ全体を乗っ取っていた)。
    expect(queryHome()).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('renders the ending gallery for the #/endings route', async () => {
    window.location.hash = '#/endings';
    try {
      render(<App />);
      // パンくずにも同じラベルが出るため、本文の見出しで判定する。
      expect(await screen.findByRole('heading', { name: 'エンディング図鑑' })).toBeInTheDocument();
    } finally {
      window.location.hash = '';
    }
  });

  it('redirects the legacy #/endings hash to the records route', async () => {
    window.location.hash = '#/endings';
    try {
      render(<App />);
      // パンくずにも同じラベルが出るため、本文の見出しで判定する。
      expect(await screen.findByRole('heading', { name: 'エンディング図鑑' })).toBeInTheDocument();
      await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
    } finally {
      window.location.hash = '';
    }
  });

  it('falls back to home when #/play points at a session that no longer exists', async () => {
    // #/play/:id はリロードしてもストレージから読み直せるが、消えたセッションを
    // 指している場合は黙って空画面にせず、理由を伝えてホームへ戻す。
    window.location.hash = '#/play/missing_session';
    render(<App />);

    expect(await screen.findByText('セッションが見つかりません')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(await findHome()).toBeInTheDocument();
  });

  it('does not carry a previously imported starter pack into a later plain new-session wizard', async () => {
    // スターターパックを取り込んでウィザードを一度離れたあと、改めて「+ 新規プレイ」で
    // 入り直した場合に、直前のWorld/Scenarioが残っていないこと。残っていると
    // 無関係な世界観・シナリオが気づかれないまま選択済みになり、ユーザーが混乱する。
    // 「+ 新規プレイ」はログイン必須で無効化されるため、/api/me はログイン済みユーザーを返す。
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }) });
        }
        // World一覧/Scenario一覧/PC一覧など、他のAPI呼び出しは空配列でよい。
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    const PACKS = [
      {
        packId: 'arkham-1920s',
        title: 'アーカム 1920s',
        tagline: '港町。',
        source: null,
        moods: ['ホラー'],
        recommendedRuleset: 'coc7e',
        scenarioTitle: '丘の上の写真館',
      },
    ];
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    vi.spyOn(starterClient, 'importStarterPack').mockResolvedValue({
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界' },
      scenario: {
        id: 'sc',
        worldId: 'arkham-1920s',
        title: '丘の上の写真館',
        recommendedRuleset: 'coc7e',
        moods: ['ホラー'],
        raw: '# シナリオ',
      },
      pcs: [],
      npcs: [],
    });

    render(<App />);
    const newButton = await screen.findByText('+ 新規プレイ');
    await waitFor(() => expect(newButton).not.toBeDisabled()); // ログイン確認が終わるまで待つ

    fireEvent.click(await screen.findByText('この冒険を始める'));

    // 取り込みが実際に効いていれば、WizardはPCステップ(4段目)からプリフィルされて開く。
    // ここを確認しないと、取り込みが裏で失敗してstarterContextが空のままでも
    // 後段の「引き継がれない」検証が意味もなく成立してしまう。
    // ステップ表示バーは常に5段すべてのラベルを描くので「4. PC」では現在地を示せない。
    // PCステップでしか描かれないField labelを見る。
    expect(await screen.findByText('PCの用意方法')).toBeInTheDocument();

    // ウィザードから離脱する。Setup自身の離脱ボタンがrouteを動かすようになるのは
    // Task 16からなので、ここではURLを直接ホームへ戻す。
    // (離脱時にcontextを消していないことこそが、この後の検証の前提になる)
    act(() => navigate({ name: 'home' }));
    expect(await findHome()).toBeInTheDocument();

    // 改めて「+ 新規プレイ」から入り直す。
    const newButton2 = await screen.findByText('+ 新規プレイ');
    await waitFor(() => expect(newButton2).not.toBeDisabled());
    fireEvent.click(newButton2);

    // クリーンな0段目で開き、Worldも未選択(空欄のまま進める)のままであること。
    // この文言はworldMode==='skip'のときにしか出ず、starterContextが残っていれば'existing'になる。
    expect(await screen.findByText('世界観を指定しない。AIが自由に構築する。')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
