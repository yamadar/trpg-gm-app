import { useRef } from 'react';
import Button from './ui/Button.jsx';
import { readFilesAsEntries } from '../utils/fileImport.js';
import { COLORS, F_MONO } from '../theme.js';

export default function FileImportRow({ entries, onImport, onClear }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  async function handleFiles(e) {
    const list = e.target.files;
    if (list && list.length > 0) {
      const entries = await readFilesAsEntries(list);
      onImport(entries);
    }
    e.target.value = '';
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={() => fileInputRef.current?.click()}>
          ファイルを選択(複数可)
        </Button>
        <Button variant="ghost" onClick={() => folderInputRef.current?.click()}>
          フォルダを選択
        </Button>
        {entries.length > 0 && (
          <Button variant="ghost" onClick={onClear}>
            インポート内容をクリア
          </Button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,.html,.htm"
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      {entries.length > 0 && (
        <div
          style={{
            marginTop: 8,
            fontFamily: F_MONO,
            fontSize: 11,
            color: COLORS.brassDark,
          }}
        >
          読み込み済み({entries.length}件): {entries.map((e) => e.name).join(', ')}
        </div>
      )}
    </div>
  );
}
