import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CharacterPanel from './CharacterPanel.jsx';

function makeSession(overrides = {}) {
  return {
    ruleset: { growthUnit: 'CP' },
    pc: { raw: 'PC名: カイ\n能力: 弓', goal: '村を守る', bonds: '村長は恩人' },
    state: { xp: 7, flags: { 鍵入手: true, 村人の信頼: 3 } },
    ...overrides,
  };
}

describe('CharacterPanel', () => {
  it('PCシート本文・goal/bonds・成長点(growthUnitラベル)を表示する', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.getByText(/PC名: カイ/)).toBeInTheDocument();
    expect(screen.getByText(/村を守る/)).toBeInTheDocument();
    expect(screen.getByText(/村長は恩人/)).toBeInTheDocument();
    expect(screen.getByText('CP: 7')).toBeInTheDocument();
  });
  it('生フラグのkey=value一覧は表示しない', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.queryByText('鍵入手 = true')).not.toBeInTheDocument();
    expect(screen.queryByText(/入手情報/)).not.toBeInTheDocument();
  });
  it('onRecall未指定なら「これまでを思い出す」ボタンを出さない', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.queryByText('これまでを思い出す')).not.toBeInTheDocument();
  });
  it('ボタン押下で回想を取得し表示する', async () => {
    const onRecall = vi.fn().mockResolvedValue('カイはこれまでの旅を思い返した。');
    render(<CharacterPanel session={makeSession()} docked onRecall={onRecall} />);
    fireEvent.click(screen.getByText('これまでを思い出す'));
    expect(await screen.findByText('カイはこれまでの旅を思い返した。')).toBeInTheDocument();
    expect(onRecall).toHaveBeenCalledTimes(1);
  });
  it('回想の取得に失敗したらエラーを表示する', async () => {
    const onRecall = vi.fn().mockRejectedValue(new Error('offline'));
    render(<CharacterPanel session={makeSession()} docked onRecall={onRecall} />);
    fireEvent.click(screen.getByText('これまでを思い出す'));
    expect(await screen.findByText(/思い出せなかった/)).toBeInTheDocument();
  });
  it('pc.rawが無ければプレースホルダを表示する', () => {
    render(<CharacterPanel session={makeSession({ pc: { raw: '' } })} docked />);
    expect(screen.getByText('(PC設定なし)')).toBeInTheDocument();
  });
  it('growthUnit未設定なら「経験値」ラベルになる', () => {
    render(<CharacterPanel session={makeSession({ ruleset: undefined })} docked />);
    expect(screen.getByText('経験値: 7')).toBeInTheDocument();
  });
  it('docked時は閉じるボタンを出さない', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.queryByLabelText('パネルを閉じる')).not.toBeInTheDocument();
  });
  it('docked=false時は閉じるボタンでonCloseを呼ぶ', () => {
    const onClose = vi.fn();
    render(<CharacterPanel session={makeSession()} docked={false} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('パネルを閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('shows resources like SAN when present', () => {
    render(
      <CharacterPanel
        session={{
          ruleset: { id: 'coc7e', formula: 'coc7e', growthUnit: '経験値' },
          pc: { raw: 'PC' },
          state: { xp: 0, resources: { san: { value: 55, max: 99 } } },
        }}
        docked
      />
    );
    expect(screen.getByText('正気度: 55/99')).toBeInTheDocument();
  });

  it('hides the resource block when resources are absent', () => {
    render(
      <CharacterPanel
        session={{ ruleset: { id: 'simple' }, pc: { raw: 'PC' }, state: { xp: 0 } }}
        docked
      />
    );
    expect(screen.queryByText(/正気度/)).not.toBeInTheDocument();
  });
});
