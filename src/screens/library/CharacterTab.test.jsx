import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CharacterTab from './CharacterTab.jsx';
import * as characterLibraryClient from '../../api/characterLibraryClient.js';
import * as shareClient from '../../api/shareClient.js';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';

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

  it('ignores a stale getCharacter response when selection changes before it resolves', async () => {
    vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
      { id: 'w1/pc/bob', worldId: 'w1', kind: 'pc', name: 'bob', revealed: null },
    ]);

    let resolveA;
    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const getSpy = vi.spyOn(characterLibraryClient, 'getCharacter').mockImplementation((worldId, kind, name) => {
      if (name === 'alice') return promiseA;
      if (name === 'bob') return Promise.resolve({ raw: 'bobの本文', revealed: null });
      return Promise.reject(new Error('unexpected name: ' + name));
    });

    render(<CharacterTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());

    fireEvent.click(screen.getByText('alice'));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('w1', 'pc', 'alice'));

    fireEvent.click(screen.getByText('bob'));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('w1', 'pc', 'bob'));
    await waitFor(() => expect(screen.getByDisplayValue('bobの本文')).toBeInTheDocument());

    await act(async () => {
      resolveA({ raw: 'aliceの本文(stale)', revealed: null });
      await promiseA;
    });

    expect(screen.getByDisplayValue('bobの本文')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('aliceの本文(stale)')).not.toBeInTheDocument();
  });

  describe('publish controls', () => {
    beforeEach(() => {
      vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
        { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
        { id: 'w1/pc/bob', worldId: 'w1', kind: 'pc', name: 'bob', revealed: null },
      ]);
    });

    it('does not render publish controls or fetch published state when logged out', async () => {
      const publishedSpy = vi.spyOn(shareClient, 'publishedCharacters');
      render(<CharacterTab worldId="w1" />);
      await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
      expect(screen.queryByText('公開')).not.toBeInTheDocument();
      expect(publishedSpy).not.toHaveBeenCalled();
    });

    it('shows a 公開中 badge for a published character and a 公開 button for an unpublished one', async () => {
      vi.spyOn(shareClient, 'publishedCharacters').mockResolvedValue({ alice: 'pub-alice' });
      renderWithAuth(<CharacterTab worldId="w1" />);

      await waitFor(() => expect(shareClient.publishedCharacters).toHaveBeenCalledWith('w1', 'pc'));
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.getByText('再公開')).toBeInTheDocument();
      expect(screen.getByText('公開解除')).toBeInTheDocument();
      expect(screen.getAllByText('公開')).toHaveLength(1);
    });

    it('clicking 公開 calls publishCharacter with worldId/kind/name and flips to the badge', async () => {
      vi.spyOn(shareClient, 'publishedCharacters').mockResolvedValue({});
      const publishSpy = vi.spyOn(shareClient, 'publishCharacter').mockResolvedValue({ publicId: 'pub-alice' });
      renderWithAuth(<CharacterTab worldId="w1" />);

      await waitFor(() => expect(screen.getAllByText('公開')).toHaveLength(2));
      fireEvent.click(screen.getAllByText('公開')[0]);

      await waitFor(() => expect(publishSpy).toHaveBeenCalledWith('w1', 'pc', 'alice'));
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.getAllByText('公開')).toHaveLength(1);
    });

    it('clicking 公開解除 calls unpublishCharacter and removes the badge', async () => {
      vi.spyOn(shareClient, 'publishedCharacters').mockResolvedValue({ alice: 'pub-alice' });
      const unpublishSpy = vi.spyOn(shareClient, 'unpublishCharacter').mockResolvedValue();
      renderWithAuth(<CharacterTab worldId="w1" />);

      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      fireEvent.click(screen.getByText('公開解除'));

      await waitFor(() => expect(unpublishSpy).toHaveBeenCalledWith('w1', 'pc', 'alice'));
      await waitFor(() => expect(screen.queryByText('公開中')).not.toBeInTheDocument());
      expect(screen.getAllByText('公開')).toHaveLength(2);
    });

    it('refetches the published-state map for the new kind when switching PC/NPC', async () => {
      const publishedSpy = vi.spyOn(shareClient, 'publishedCharacters').mockResolvedValue({});
      renderWithAuth(<CharacterTab worldId="w1" />);
      await waitFor(() => expect(publishedSpy).toHaveBeenCalledWith('w1', 'pc'));

      fireEvent.click(screen.getByText('NPC'));
      await waitFor(() => expect(publishedSpy).toHaveBeenCalledWith('w1', 'npc'));
    });
  });
});
