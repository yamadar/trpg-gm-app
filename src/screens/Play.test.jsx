import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Play from './Play.jsx';
import * as sessionSyncClient from '../api/sessionSyncClient.js';

function makeSession(overrides = {}) {
  return {
    id: 's1',
    title: 'テストセッション',
    world: { raw: '', summary: '' },
    scenario: { raw: '' },
    rulesetId: 'simple',
    pc: { raw: '' },
    state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0 },
    log: [],
    updatedAt: 0,
    ...overrides,
  };
}

// Playはsessionをpropで受け取るcontrolled componentなので、setSessionをモック関数の
// ままにするとPlayが更新後のsessionを再描画できない。App.jsxと同様に親側でstateを
// 持つ小さなハーネスを用意し、実際の再レンダリングを再現する。
function Harness({ initialSession, onExit }) {
  const [session, setSession] = useState(initialSession);
  return <Play session={session} setSession={setSession} onExit={onExit} />;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              narrative: '物語が始まった。',
              state_update: { xp_gained: 5 },
              choices: ['進む'],
            }),
          },
        ],
      }),
    })
  );
  // sessionSyncClient.putSessionToServer also calls the global fetch mock above; stub it
  // out by default so it doesn't inflate fetch-call-count assertions in unrelated tests.
  // The dedicated sync test below overrides this with its own mockRejectedValue.
  vi.spyOn(sessionSyncClient, 'putSessionToServer').mockResolvedValue({});
});

describe('Play', () => {
  it('requests an opening scene when the log is empty and renders the narrative', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('進む')).toBeInTheDocument();
  });

  it('does not request an opening scene when the log already has entries', async () => {
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    render(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('既存のログ')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fires the opening turn exactly once under React.StrictMode double-invocation', async () => {
    render(
      <React.StrictMode>
        <Harness initialSession={makeSession()} onExit={vi.fn()} />
      </React.StrictMode>
    );
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('accumulates xp_gained into session.state.xp and displays it with the growthUnit label', async () => {
    const session = makeSession({ ruleset: { id: 'gurps', label: 'GURPS風', desc: '', hint: '', growthUnit: 'CP' } });
    render(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('CP: 5')).toBeInTheDocument();
  });

  it('defaults the growth label to "経験値" when session.ruleset is absent', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('経験値: 5')).toBeInTheDocument();
  });

  it('syncs the updated session to the server after a turn, without blocking on failure', async () => {
    const putSpy = vi.spyOn(sessionSyncClient, 'putSessionToServer').mockRejectedValue(new Error('offline'));
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    // 同期失敗してもUIはエラー表示しない(ゲーム進行は止めない)
    expect(screen.queryByText(/GM応答の取得に失敗した/)).not.toBeInTheDocument();
  });
});
