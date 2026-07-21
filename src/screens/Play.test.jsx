import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Play from './Play.jsx';

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
            text: JSON.stringify({ narrative: '物語が始まった。', state_update: {}, choices: ['進む'] }),
          },
        ],
      }),
    })
  );
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
});
