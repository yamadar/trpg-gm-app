// PCシート本文の「PC名: ○○」行の読み書き。
// PC名はストレージのキーにはせず(characterDocPathが名前をそのままパスへ埋めるため)、
// 表示とプロンプトのための値として本文の中に持たせる。

// 全角コロンも許す。プレイヤーが日本語入力のまま書いた本文を弾かないため。
const PC_NAME_LINE = /^[ \t]*PC名[ \t]*[:：][ \t]*(.+?)[ \t]*$/m;

export function extractPcName(raw) {
  const m = String(raw ?? '').match(PC_NAME_LINE);
  return m ? m[1] : '';
}

// 既にPC名行がある本文には足さない。プレイヤーが書いた表記(愛称・肩書き込みなど)を
// 入力欄の値で上書きしてしまわないため。
export function composePcRaw(name, raw) {
  const body = String(raw ?? '').trim();
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return body;
  if (extractPcName(body)) return body;
  return body ? `PC名: ${trimmed}\n${body}` : `PC名: ${trimmed}`;
}
