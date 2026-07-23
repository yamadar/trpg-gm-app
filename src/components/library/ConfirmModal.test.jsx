import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmModal from './ConfirmModal.jsx';

describe('ConfirmModal', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmModal open={false} message="削除しますか?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('削除しますか?')).not.toBeInTheDocument();
  });

  it('shows the message and calls onConfirm when confirmed', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal open={true} message="本当に削除しますか?" onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText('本当に削除しますか?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('削除する'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancelled', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal open={true} message="本当に削除しますか?" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button when confirmDisabled is true', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal open={true} message="削除しますか?" confirmDisabled onConfirm={onConfirm} onCancel={vi.fn()} />
    );
    const btn = screen.getByText('削除する');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('defaults the confirm label to 削除する when confirmLabel is not passed', () => {
    render(<ConfirmModal open={true} message="削除しますか?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('削除する')).toBeInTheDocument();
  });

  it('renders a custom confirmLabel when provided', () => {
    render(
      <ConfirmModal
        open={true}
        message="保存しますか?"
        confirmLabel="保存する"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('保存する')).toBeInTheDocument();
    expect(screen.queryByText('削除する')).not.toBeInTheDocument();
  });
});
