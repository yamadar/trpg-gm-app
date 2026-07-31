import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignTab from './CampaignTab.jsx';
import * as campaignClient from '../../api/campaignClient.js';
import * as worldClient from '../../api/worldLibraryClient.js';
import * as scenarioClient from '../../api/scenarioLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(campaignClient, 'getCampaignSource').mockResolvedValue({ raw: '' });
  vi.spyOn(campaignClient, 'putCampaignSource').mockResolvedValue({ raw: '' });
  vi.spyOn(campaignClient, 'getCampaignPitches').mockResolvedValue(null);
  vi.spyOn(campaignClient, 'getCampaignReconciliation').mockResolvedValue(null);
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
    fireEvent.click(await screen.findByRole('tab', { name: '章' }));
    expect(await screen.findByText(/第一章/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '引き継ぎPC' }));
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
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('w1', 'cp1', {
        title: '光の連鎖',
        carriedPc: CP.carriedPc,
        chapters: CP.chapters,
        currentState: undefined,
        canonRevision: undefined,
        rulesetId: undefined,
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

  it('章精算案を既定で未選択にし、GMが選んだ変更だけを正史へ反映する', async () => {
    const pending = {
      ...CP,
      currentState: { canonFacts: [], characters: [], factions: [], timeline: [], openThreads: [] },
      canonRevision: 0,
      chapters: [{ sessionId: 's1', title: '第一章', status: 'ended', endedAt: 1 }],
    };
    const reconciled = {
      ...pending,
      canonRevision: 1,
      chapters: [{ ...pending.chapters[0], status: 'reconciled' }],
    };
    const draft = {
      sessionId: 's1',
      status: 'ready',
      summary: '橋を落とした。',
      proposedPcRaw: 'PC名: カイ\n所持品: 印章',
      changes: [
        { id: 'change_1', kind: 'canon_fact_add', title: '橋が崩落', details: '北門は通れない。' },
      ],
    };
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([pending]);
    vi.spyOn(campaignClient, 'getCampaign')
      .mockResolvedValueOnce(pending)
      .mockResolvedValue(reconciled);
    campaignClient.getCampaignReconciliation.mockResolvedValueOnce(draft);
    const acceptSpy = vi.spyOn(campaignClient, 'acceptCampaignReconciliation').mockResolvedValue(reconciled);

    render(<CampaignTab worldId="w1" focusCampaignId="cp1" focusSessionId="s1" />);

    expect(await screen.findByText('章精算案 — GM確認')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText('選んだ内容を正史へ反映'));

    await waitFor(() => expect(acceptSpy).toHaveBeenCalled());
    expect(acceptSpy.mock.calls[0][3]).toMatchObject({
      summary: '橋を落とした。',
      pcRaw: 'PC名: カイ\n所持品: 印章',
      changes: [expect.objectContaining({ id: 'change_1', title: '橋が崩落' })],
    });
  });

  it('正史準拠の候補をScenario化し、由来メタ付きで保存してSetup文脈を返す', async () => {
    const campaign = {
      ...CP,
      currentState: { canonFacts: [], characters: [], factions: [], timeline: [], openThreads: [] },
      canonRevision: 3,
      rulesetId: 'simple',
      chapters: [{ sessionId: 's1', title: '第一章', status: 'reconciled', endedAt: 1 }],
    };
    const bundle = {
      basedOnCanonRevision: 3,
      pitches: [
        {
          id: 'pitch_1',
          title: '灰の密使',
          hook: '密使が現れる。',
          centralConflict: '印章を巡る争い',
          continuityReasons: ['前章の印章が発端'],
        },
      ],
    };
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([campaign]);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(campaign);
    vi.spyOn(campaignClient, 'generateCampaignPitches').mockResolvedValue(bundle);
    vi.spyOn(campaignClient, 'generateCampaignScenario').mockResolvedValue({
      title: '灰の密使',
      raw: '## シナリオ概要\n密使を救う。',
      pitchId: 'pitch_1',
    });
    const putScenarioSpy = vi.spyOn(scenarioClient, 'putScenario').mockResolvedValue({
      id: 'gray-envoy',
      title: '灰の密使',
      raw: '## シナリオ概要\n密使を救う。',
    });
    vi.spyOn(worldClient, 'getWorld').mockResolvedValue({ id: 'w1', raw: '# World', moods: ['シリアス'] });
    const onStartChapter = vi.fn();

    render(
      <CampaignTab
        worldId="w1"
        focusCampaignId="cp1"
        onStartChapter={onStartChapter}
      />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: '次話を作る' }));
    fireEvent.click(screen.getByText('次話候補を作る'));
    fireEvent.click(await screen.findByText('灰の密使'));
    fireEvent.click(screen.getByText('選択案からScenarioを生成'));
    expect(await screen.findByText('Scenarioを保存して次章を始める')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Scenarioを保存して次章を始める'));

    await waitFor(() => expect(putScenarioSpy).toHaveBeenCalled());
    expect(putScenarioSpy.mock.calls[0][2]).toMatchObject({
      sourceCampaignId: 'cp1',
      sourceCampaignRevision: 3,
      generatedFromPitchId: 'pitch_1',
    });
    await waitFor(() => expect(onStartChapter).toHaveBeenCalled());
    expect(onStartChapter.mock.calls[0][0]).toMatchObject({
      worldId: 'w1',
      campaignId: 'cp1',
      xp: 12,
      scenario: expect.objectContaining({ id: 'gray-envoy', sourceCampaignRevision: 3 }),
    });
  });
});
