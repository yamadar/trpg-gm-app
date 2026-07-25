import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from './Modal.jsx';

describe('Modal', () => {
  it('exposes a dialog with an accessible name from its title', () => {
    render(
      <Modal open onClose={vi.fn()} title="ログイン">
        <button type="button">Google でログイン</button>
      </Modal>
    );
    expect(screen.getByRole('dialog', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('falls back to the label prop when there is no visible title', () => {
    render(
      <Modal open onClose={vi.fn()} label="本当に削除しますか?">
        <button type="button">削除する</button>
      </Modal>
    );
    expect(screen.getByRole('dialog', { name: '本当に削除しますか?' })).toBeInTheDocument();
  });

  it('moves focus into the dialog when it opens', () => {
    render(
      <Modal open onClose={vi.fn()} label="確認">
        <button type="button">最初のボタン</button>
        <button type="button">次のボタン</button>
      </Modal>
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '最初のボタン' }));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} label="確認">
        <button type="button">OK</button>
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // Tab が背後のページへ抜けると、モーダルが開いているのに裏の要素を操作できてしまう。
  it('wraps focus from the last control back to the first on Tab', () => {
    render(
      <Modal open onClose={vi.fn()} label="確認">
        <button type="button">最初のボタン</button>
        <button type="button">最後のボタン</button>
      </Modal>
    );
    const last = screen.getByRole('button', { name: '最後のボタン' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '最初のボタン' }));
  });

  it('restores focus to the element that was focused before opening', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            開く
          </button>
          <Modal open={open} onClose={() => setOpen(false)} label="確認">
            <button type="button">閉じる</button>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '開く' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} label="確認">
        <button type="button">OK</button>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
