import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignTab from './CampaignTab.jsx';
import * as campaignClient from '../../api/campaignClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const CP = {
  id: 'cp1',
  worldId: 'w1',
  title: '影の連鎖',
  carriedPc: { raw: 'PC名: カイ(熟練)', xp: 12 },
  chapters: [{ sessionId: 's1', title: '第一章', endedAt: 1 }],
};

describe('CampaignTab', () => {
  it('worldId未選択ならプレースホルダを出す', () => {
    render(<CampaignTab worldId={null} />);
    expect(screen.getByText(/先にWorldタブ/)).toBeInTheDocument();
  });

  it('一覧を表示し、選択で章とcarriedPcを読み取り専用表示する', async () => {
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([CP]);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(CP);
    render(<CampaignTab worldId="w1" />);
    fireEvent.click(await screen.findByText('影の連鎖'));
    expect(await screen.findByText(/第一章/)).toBeInTheDocument();
    expect(screen.getByText(/PC名: カイ\(熟練\)/)).toBeInTheDocument();
    expect(screen.getByText('CP: 12')).toBeInTheDocument();
  });

  it('改名保存で既存のcarriedPc/chaptersごとputCampaignを呼ぶ', async () => {
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([CP]);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(CP);
    const putSpy = vi.spyOn(campaignClient, 'putCampaign').mockResolvedValue(CP);
    render(<CampaignTab worldId="w1" />);
    fireEvent.click(await screen.findByText('影の連鎖'));
    const input = await screen.findByDisplayValue('影の連鎖');
    fireEvent.change(input, { target: { value: '光の連鎖' } });
    fireEvent.click(screen.getByText('保存する'));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('w1', 'cp1', {
        title: '光の連鎖',
        carriedPc: CP.carriedPc,
        chapters: CP.chapters,
      })
    );
  });

  it('削除は確認モーダルを経てdeleteCampaignを呼ぶ', async () => {
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([CP]);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(CP);
    const delSpy = vi.spyOn(campaignClient, 'deleteCampaign').mockResolvedValue(undefined);
    render(<CampaignTab worldId="w1" />);
    fireEvent.click(await screen.findByText('影の連鎖'));
    fireEvent.click(await screen.findByText('削除'));
    fireEvent.click(screen.getByText('削除する')); // ConfirmModal
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('w1', 'cp1'));
  });
});
