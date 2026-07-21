import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CharacterTab from './CharacterTab.jsx';
import * as characterLibraryClient from '../../api/characterLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('CharacterTab', () => {
  it('shows guidance when no world is selected', () => {
    render(<CharacterTab worldId={null} />);
    expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument();
  });

  it('lists PC characters for the selected world', async () => {
    vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
    ]);
    render(<CharacterTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    expect(characterLibraryClient.listCharacters).toHaveBeenCalledWith('w1', 'pc');
  });

  it('shows the revealed badge for NPCs and switches list on kind toggle', async () => {
    const listSpy = vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
      { id: 'w1/npc/villain', worldId: 'w1', kind: 'npc', name: 'villain', revealed: true },
    ]);
    render(<CharacterTab worldId="w1" />);
    fireEvent.click(screen.getByText('NPC'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('w1', 'npc'));
    expect(screen.getByText('villain')).toBeInTheDocument();
    expect(screen.getByText('開示済み')).toBeInTheDocument();
  });

  it('creates a new PC via putCharacter', async () => {
    vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacter').mockResolvedValue({});
    render(<CharacterTab worldId="w1" />);
    await waitFor(() => expect(characterLibraryClient.listCharacters).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ 新規Character'));
    fireEvent.change(screen.getByPlaceholderText('例: alice'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByPlaceholderText('PC/NPCシートの本文'), { target: { value: 'goal: ...' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('w1', 'pc', 'alice', { raw: 'goal: ...', revealed: undefined })
    );
  });

  it('deletes a character after confirmation', async () => {
    vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ raw: '本文', revealed: null });
    const deleteSpy = vi.spyOn(characterLibraryClient, 'deleteCharacter').mockResolvedValue();

    render(<CharacterTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('alice'));
    await waitFor(() => expect(screen.getByText('削除')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('w1', 'pc', 'alice'));
  });
});
