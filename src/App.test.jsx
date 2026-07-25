import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';
import * as shareClient from './api/shareClient.js';
import * as starterClient from './api/starterClient.js';

afterEach(() => {
  window.location.hash = '';
});

describe('App', () => {
  it('shows the home screen after the initial storage check completes', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());
    expect(screen.getByText('+ 新規プレイ')).toBeInTheDocument();
  });

  it('navigates to the library screen and back', async () => {
    // ライブラリはログイン必須なので、/api/meはログイン済みユーザーを返す必要がある
    // (それ以外のURL、たとえばWorld一覧取得は空配列を返す)。
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByText('素材ライブラリ'));
    await waitFor(() => expect(screen.getByText('素材ライブラリ')).toBeInTheDocument());
    expect(screen.getByText('World一覧')).toBeInTheDocument();

    fireEvent.click(screen.getByText('閉じる'));
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  it('navigates to the public gallery screen and back, without requiring login', async () => {
    // ギャラリーは未ログインでも閲覧できる想定なので、/api/meは未ログイン(userなし)を返す。
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
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByText('公開ギャラリー'));
    // 既定タブは「おすすめ」(スターターパック)になったため、公開アイテム一覧の
    // 空状態を見るには明示的に他タブへ切り替える。
    fireEvent.click(await screen.findByText('小説'));
    await waitFor(() => expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument());

    fireEvent.click(screen.getByText('閉じる'));
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    vi.unstubAllGlobals();
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
    expect(screen.queryByText("GM's Desk")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('renders the ending gallery for the #/endings route', async () => {
    window.location.hash = '#/endings';
    try {
      render(<App />);
      expect(await screen.findByText('エンディング図鑑')).toBeInTheDocument();
    } finally {
      window.location.hash = '';
    }
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

    // ウィザードを「やめる」で離脱する(やめるボタンは0段目にしか無いため、まず戻る)。
    fireEvent.click(screen.getByText('戻る'));
    fireEvent.click(screen.getByText('戻る'));
    fireEvent.click(screen.getByText('戻る'));
    fireEvent.click(screen.getByText('やめる'));
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

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
