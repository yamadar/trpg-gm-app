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
});
