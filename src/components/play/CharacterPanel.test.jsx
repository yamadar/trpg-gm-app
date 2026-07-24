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
  it('既知フラグをkey = valueで一覧表示する', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.getByText('鍵入手 = true')).toBeInTheDocument();
    expect(screen.getByText('村人の信頼 = 3')).toBeInTheDocument();
  });
  it('フラグが空なら「まだなし」を表示する', () => {
    render(<CharacterPanel session={makeSession({ state: { xp: 0, flags: {} } })} docked />);
    expect(screen.getByText('まだなし')).toBeInTheDocument();
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
});
