import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileImportRow from './FileImportRow.jsx';

describe('FileImportRow', () => {
  it('shows import buttons and no summary when there are no entries', () => {
    render(<FileImportRow entries={[]} onImport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('ファイルを選択(複数可)')).toBeInTheDocument();
    expect(screen.getByText('フォルダを選択')).toBeInTheDocument();
    expect(screen.queryByText(/読み込み済み/)).not.toBeInTheDocument();
  });

  it('shows a summary and clear button when entries exist', () => {
    render(<FileImportRow entries={[{ name: 'a.md', content: 'x' }]} onImport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText(/読み込み済み\(1件\): a\.md/)).toBeInTheDocument();
    expect(screen.getByText('インポート内容をクリア')).toBeInTheDocument();
  });
});
