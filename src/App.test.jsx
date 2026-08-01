import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import App from './App.jsx';
import { navigate } from './navigation/useRoute.js';
import * as shareClient from './api/shareClient.js';
import * as starterClient from './api/starterClient.js';
import * as storage from './storage/index.js';
import * as sessionApi from './api/session.js';
import * as campaignClient from './api/campaignClient.js';
import * as sessionSyncClient from './api/sessionSyncClient.js';
import * as partyClient from './api/partyClient.js';

afterEach(() => {
  window.location.hash = '';
  // spy / stub がテストをまたいで残ると、後続のテストが実物ではなく前のテストの
  // モックを見てしまうため、ここでまとめて戻す。
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it('reads the session list once on the initial home render', async () => {
    const listSpy = vi.spyOn(storage, 'listSessions').mockResolvedValue([]);
    render(<App />);
    await findHome();
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('shows overwrite warning and can adopt progress from another device', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    render(<App />);
    await findHome();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(sessionSyncClient.SESSION_CONFLICT_EVENT, {
          detail: {
            sessionId: 's1',
            reason: 'write-conflict',
            local: { id: 's1', title: 'local', state: { turn_count: 2 }, log: [], updatedAt: 2 },
            remote: {
              id: 's1',
              title: 'remote',
              state: { turn_count: 3 },
              log: [],
              updatedAt: 3,
              _sync: { revision: 2 },
            },
          },
        })
      );
    });

    expect(screen.getByRole('heading', { name: '別端末の進捗を検出' })).toBeInTheDocument();
    expect(screen.getByText(/別端末の進捗が失われる/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '別端末の進捗を使う' }));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', title: 'remote' }))
    );
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '別端末の進捗を検出' })).not.toBeInTheDocument()
    );
  });

  it('does not read the session list when opening a play route directly', async () => {
    // ホーム一覧は #/play では使わない。マウント時に無条件で取っていたころは
    // 開くだけで無駄な読み取りが1回走っていた。
    const listSpy = vi.spyOn(storage, 'listSessions').mockResolvedValue([]);
    vi.spyOn(storage, 'getSession').mockResolvedValue({
      id: 'sess_1',
      title: 'テストセッション',
      world: { raw: '', summary: '' },
      scenario: { raw: '' },
      rulesetId: 'simple',
      pc: { raw: '' },
      state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0 },
      log: [],
      updatedAt: 0,
    });
    window.location.hash = '#/play/sess_1';
    render(<App />);
    await screen.findByText('テストセッション');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('remounts PartyPlay when navigating directly between Party sessions', async () => {
    const partySnapshot = (id) => ({
      id,
      title: id === 'p1' ? '旧Party' : '新Party',
      status: 'playing',
      settings: {},
      participants: [{
        userId: 'u1',
        displayName: 'ホスト',
        role: 'host',
        pcId: 'pc1',
        activity: 'active',
        awayPolicy: 'follow',
        connection: 'online',
        typing: false,
      }],
      pcs: [{ id: 'pc1', characterName: 'カイ' }],
      me: { userId: 'u1', role: 'host', pcId: 'pc1' },
      round: {
        id: 'round_1',
        phase: 'collecting',
        deadlineAt: Date.now() + 90_000,
        intents: [],
        readyUserIds: [],
      },
      snapshot: { narratives: [], choicesByPc: {} },
      serverNow: Date.now(),
    });
    vi.spyOn(partyClient, 'getPartySnapshot').mockImplementation(async (id) => partySnapshot(id));
    vi.spyOn(partyClient, 'getPartyChat').mockImplementation(async (id, after) => ({
      messages: after === 0
        ? [{ id: `chat_${id}_1`, seq: 1, displayName: 'ホスト', text: `${id}の相談` }]
        : [],
      nextSeq: 1,
    }));

    window.location.hash = '#/party/p1';
    render(<App />);
    await waitFor(() => expect(document.body).toHaveTextContent('p1の相談'));

    act(() => navigate({ name: 'party', sessionId: 'p2' }));
    await waitFor(() => expect(document.body).toHaveTextContent('p2の相談'));
    expect(document.body).not.toHaveTextContent('p1の相談');
    expect(partyClient.getPartyChat).toHaveBeenCalledWith('p2', 0);
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

    // Task 12でGalleryがroute駆動になったため、タブ切り替えもURLに乗る。
    // 未ログインのまま公開一覧を見られること(画面内タブ切り替え)も併せて確かめる。
    fireEvent.click(await screen.findByText('小説'));
    await waitFor(() => expect(window.location.hash).toBe('#/browse/novels'));
    expect(await screen.findByText('まだ公開されたものがありません')).toBeInTheDocument();
  });

  it('keeps the global nav visible on every browsing screen', async () => {
    render(<App />);
    await findHome();
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '記録' }));
    await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
    expect(await screen.findByRole('heading', { name: 'エンディング図鑑' })).toBeInTheDocument();
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

  it('keeps the hash when stripping auth_error from the query', async () => {
    // hash が現在地の唯一の情報源になったので、クエリを畳む replaceState が
    // hash まで巻き添えにしてはいけない。replaceState は hashchange を発火しないため、
    // 落とすと画面は記録タブのまま URL だけ "/" になり、リロードで別画面に着地する。
    window.history.pushState({}, '', '/?auth_error=1#/records/endings');
    const realReplace = window.history.replaceState.bind(window.history);
    const urls = [];
    vi.spyOn(window.history, 'replaceState').mockImplementation((s, t, url) => {
      urls.push(url);
      return realReplace(s, t, url);
    });
    try {
      render(<App />);
      await waitFor(() =>
        expect(screen.getByText('ログインに失敗しました。もう一度お試しください。')).toBeInTheDocument()
      );
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('#/records/endings');
      expect(await screen.findByRole('heading', { name: 'エンディング図鑑' })).toBeInTheDocument();
      // 末尾の状態だけを見ると、useRoute の正準化がずれた hash を差し戻すため
      // 落とした事実が隠れてしまう。クエリを畳む書き換え自体が hash を
      // 持ったままであることを確かめる。
      // 空配列に対して every は true を返すため、書き換えが1回も観測できていない
      // 場合(pushState 等に作り替えられた場合)にこの検証は黙って無意味になる。
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((u) => String(u).includes('#/records/endings'))).toBe(true);
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('renders UserPage when the hash matches #/u/{userId}, keeping the account menu visible', async () => {
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

  // 回帰テスト: 取り込みは押した瞬間には終わらない。本番のように遅いと、待ちきれずに
  // 「+ 新規プレイ」で先へ進んだ後に取り込みが完了する、という順序が普通に起きる。
  // そのとき navigate は hash が既に #/setup なので何もせず、Setup は文脈をマウント時にしか
  // 読まないため、ウィザードは0段目(空欄のまま進める)のまま取り残されていた。
  it('opens the wizard on the PC step when a slow starter import lands after the wizard is already open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    vi.spyOn(storage, 'listSessions').mockResolvedValue([]);
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({
      packs: [
        {
          packId: 'arkham-1920s',
          title: 'アーカム 1920s',
          tagline: '港町。',
          source: null,
          moods: ['ホラー'],
          recommendedRuleset: 'coc7e',
          scenarioTitle: '丘の上の写真館',
        },
      ],
      seededAt: 1,
    });
    let resolveImport;
    const pending = new Promise((resolve) => {
      resolveImport = resolve;
    });
    vi.spyOn(starterClient, 'importStarterPack').mockReturnValue(pending);

    render(<App />);
    const newButton = await screen.findByText('+ 新規プレイ');
    await waitFor(() => expect(newButton).not.toBeDisabled());

    fireEvent.click(await screen.findByText('この冒険を始める'));
    // 取り込みの完了を待たずに、素のウィザードへ入ってしまう。
    fireEvent.click(newButton);
    expect(await screen.findByText('Worldの用意方法')).toBeInTheDocument();

    // ここで取り込みが完了する。行き先(#/setup)は既に開いているが、
    // 押したのはスターターパックなので、ウィザードはPCステップで開き直さなければならない。
    await act(async () => {
      resolveImport({
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
      await pending;
    });

    expect(await screen.findByText('PCの用意方法')).toBeInTheDocument();
    expect(screen.queryByText('Worldの用意方法')).not.toBeInTheDocument();
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
    // FocusHeaderのステップ表示は常に5段すべてのラベルを描き、現在地は
    // aria-current="step" で示す。ここで見たいのは本文まで開けていることなので、
    // PCステップでしか描かれないField labelを見る。
    expect(await screen.findByText('PCの用意方法')).toBeInTheDocument();

    // ウィザードを離脱する(FocusHeaderの「やめる」はどのステップからでも押せる)。
    // スターター取り込みでWorld/Scenarioが選択済みになっているため、離脱には
    // 確認モーダルを挟む。ここで確定させることこそが、この後の検証の前提になる。
    // (離脱時にcontextを消していないことこそが、この後の検証の前提になる)
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    fireEvent.click(screen.getByRole('button', { name: '破棄して離れる' }));
    expect(await findHome()).toBeInTheDocument();

    // 改めて「+ 新規プレイ」から入り直す。
    const newButton2 = await screen.findByText('+ 新規プレイ');
    await waitFor(() => expect(newButton2).not.toBeDisabled());
    fireEvent.click(newButton2);

    // クリーンな0段目で開き、Worldも未選択(空欄のまま進める)のままであること。
    // この文言はworldMode==='skip'のときにしか出ず、starterContextが残っていれば'existing'になる。
    expect(await screen.findByText('世界観を指定しない。AIが自由に構築する。')).toBeInTheDocument();
  });

  it('routes a later 次話作成 into the Campaign workspace instead of the old starter wizard', async () => {
    // スターター取り込み文脈が残っていても、次話作成は章精算用Campaign画面へ入る。
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    vi.spyOn(storage, 'listSessions').mockResolvedValue([
      {
        id: 's1',
        title: '第一章',
        updatedAt: 1,
        worldId: 'w1',
        world: { raw: 'r', summary: 'ある世界' },
        rulesetId: 'simple',
        moods: [],
        pc: { raw: '元シート' },
        state: { xp: 3, flags: {}, recent_log: [] },
        log: [{ role: 'gm', text: '物語' }],
      },
    ]);
    vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(null);
    vi.spyOn(campaignClient, 'putCampaign').mockResolvedValue({});
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([]);
    vi.spyOn(sessionSyncClient, 'putSessionToServer').mockResolvedValue({});
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({
      packs: [
        {
          packId: 'arkham-1920s',
          title: 'アーカム 1920s',
          tagline: '港町。',
          source: null,
          moods: ['ホラー'],
          recommendedRuleset: 'coc7e',
          scenarioTitle: '丘の上の写真館',
        },
      ],
      seededAt: 1,
    });
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
    await findHome();

    // まずスターターパックを取り込む(starterContext が載る)。ホームの取り込み口は
    // セッションが1件も無いときにしか出ないので、公開ギャラリー側から取り込む。
    fireEvent.click(screen.getByRole('button', { name: 'さがす' }));
    fireEvent.click(await screen.findByText('この冒険を始める'));
    expect(await screen.findByText('PCの用意方法')).toBeInTheDocument();

    // ウィザードを離脱する(FocusHeaderの「やめる」はどのステップからでも押せる)。
    // スターター取り込みでWorld/Scenarioが選択済みになっているため、離脱には
    // 確認モーダルを挟む。離脱時に文脈を消していないことがこの後の前提になる。
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    fireEvent.click(screen.getByRole('button', { name: '破棄して離れる' }));
    await findHome();

    // 別セッションの「次話を作る」は旧Setupへ直行せず、章精算を行うCampaign制作画面へ入る。
    fireEvent.click(await screen.findByText('次話を作る'));
    await waitFor(() => expect(window.location.hash).toBe('#/library/campaign/w1'));
    expect(await screen.findByText('Campaign一覧')).toBeInTheDocument();
    expect(screen.queryByText('PCの用意方法')).not.toBeInTheDocument();
    expect(screen.queryByText('丘の上の写真館')).not.toBeInTheDocument();
  });

  it('clears the session-not-found banner once another route is opened', async () => {
    // バナーはシェルの子として全ルートに描かれるため、消さないと壊れたリンクを
    // 一度踏んだだけで、以降ずっとすべての画面の先頭に居座る。
    window.location.hash = '#/play/missing_session';
    render(<App />);
    expect(await screen.findByText('セッションが見つかりません')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/'));

    fireEvent.click(screen.getByRole('button', { name: '記録' }));
    await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
    await waitFor(() =>
      expect(screen.queryByText('セッションが見つかりません')).not.toBeInTheDocument()
    );
  });

  it('does not bring the session-not-found banner back when returning to the route that raised it', async () => {
    // バナーは一度きり。描画を「今どのルートに居るか」の突き合わせだけで抑えると、
    // 値が残ったままホームへ戻ってきた瞬間に、新しい失敗が何も起きていないのに
    // 同じバナーがまた出る(しかもマウントが続く限り毎回)。
    window.location.hash = '#/play/missing_session';
    render(<App />);
    expect(await screen.findByText('セッションが見つかりません')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/'));

    fireEvent.click(screen.getByRole('button', { name: '記録' }));
    await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
    await waitFor(() =>
      expect(screen.queryByText('セッションが見つかりません')).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'ホーム' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(await findHome()).toBeInTheDocument();
    expect(screen.queryByText('セッションが見つかりません')).not.toBeInTheDocument();
  });

  it('clears the auth error banner once another route is opened', async () => {
    window.history.pushState({}, '', '/?auth_error=1');
    try {
      render(<App />);
      await waitFor(() =>
        expect(screen.getByText('ログインに失敗しました。もう一度お試しください。')).toBeInTheDocument()
      );

      fireEvent.click(screen.getByRole('button', { name: '記録' }));
      await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
      await waitFor(() =>
        expect(
          screen.queryByText('ログインに失敗しました。もう一度お試しください。')
        ).not.toBeInTheDocument()
      );

      // 戻ってきても甦らない。auth_error は URL からも落ちているので、
      // ここでバナーが出るなら「消し忘れた値がまだ生きている」ことにしかならない。
      fireEvent.click(screen.getByRole('button', { name: 'ホーム' }));
      await waitFor(() => expect(window.location.hash).toBe('#/'));
      expect(await findHome()).toBeInTheDocument();
      expect(
        screen.queryByText('ログインに失敗しました。もう一度お試しください。')
      ).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('shows a loading placeholder while the play session is being read', async () => {
    // 集中モードのシェルはナビを描かないので、読み込み中に何も出さないと
    // 真っ白で操作不能な画面になる。
    let resolveGet;
    vi.spyOn(storage, 'getSession').mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      })
    );
    window.location.hash = '#/play/slow_session';
    render(<App />);

    expect(await screen.findByText('読み込み中…')).toBeInTheDocument();

    await act(async () => {
      resolveGet(null);
    });
  });

  it('re-reads storage when the same play route is opened again after leaving it', async () => {
    // メモリ上の session を握ったままだと、素材ライブラリから消したセッションへ
    // 同じ URL で戻ったときに古い内容をそのまま映してしまう。
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: null }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    const getSpy = vi.spyOn(storage, 'getSession').mockResolvedValue({
      id: 'sess_1',
      title: 'テストセッション',
      world: { raw: '', summary: '' },
      scenario: { raw: '' },
      rulesetId: 'simple',
      pc: { raw: '' },
      state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0 },
      log: [],
      updatedAt: 0,
    });
    window.location.hash = '#/play/sess_1';
    render(<App />);
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('sess_1'));

    act(() => navigate({ name: 'home' }));
    await findHome();

    // ここでセッションが消えた状態にする。
    getSpy.mockResolvedValue(null);
    act(() => navigate({ name: 'play', sessionId: 'sess_1' }));

    expect(await screen.findByText('セッションが見つかりません')).toBeInTheDocument();
  });
});
