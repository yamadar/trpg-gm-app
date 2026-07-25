// セッションログから小説本文を生成する。出力上限で切れた場合は継続リクエストで
// 書き足させ、完結した本文を返す。ジョブの状態管理は novelJobs.js の責務。

// HTTPリクエストが応答を待たなくなったので、上流の打ち切りは同期時代の120秒から延ばす。
export const NOVELIZE_UPSTREAM_TIMEOUT_MS = 300000;
// 非ストリーミングで安全に受け取れる範囲の上限。大きいほど継続回数が減る。
export const NOVELIZE_MAX_TOKENS = 16000;
// 打ち切りが続いた場合の継続回数の上限。初回と合わせて最大5リクエスト。
// モデルが終われない場合にコストが際限なく膨らむのを防ぐための頭打ち。
export const NOVELIZE_MAX_CONTINUATIONS = 4;

const MARKER_INSTRUCTION =
  '\nトランスクリプト中の〈挿絵N〉は対応する場面の挿絵挿入位置である。小説本文の対応する場面の切れ目に、各マーカーを一度だけ行独立でそのまま残すこと。';

const CONTINUE_INSTRUCTION =
  '直前の出力は出力上限に達して途中で切れている。切れた箇所の直後から、自然につながるように本文を書き続けよ。すでに書いた部分を繰り返したり要約したりしないこと。「続き」などの前置きや説明文は一切付けず、小説本文のみを出力すること。';

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// pov: 'third'(既定)または 'first'。
function buildNovelizeSystemPrompt(pov) {
  const voice = pov === 'first' ? 'PC視点の一人称' : '三人称';
  return `以下はTRPGセッションの進行ログである。プレイヤー発言とGMの地の文が交互に並んでいる。これを${voice}の小説として、場面転換や心理描写を補いながら自然な文章に書き直せ。ゲーム的な表現(選択肢・判定結果の数値等)はそのまま出力せず、物語として自然に溶け込ませること。説明文やコードブロック記号は付けず、小説本文のみを出力すること。`;
}

// トランスクリプトは継続のたびに再送されるため、キャッシュ対象として印を付ける。
// 継続が起きるのは長いログのときであり、キャッシュが最も効く場面と一致する。
function transcriptMessage(transcript) {
  return {
    role: 'user',
    content: [{ type: 'text', text: transcript, cache_control: { type: 'ephemeral' } }],
  };
}

// これまでの出力は「末尾の」assistantターンには置けない(Sonnet 5はprefillを400で拒否する)。
// 中間のassistantターンとして置き、末尾をuserターンの継続指示にする。
function buildMessages(transcript, soFar) {
  const head = transcriptMessage(transcript);
  if (!soFar) return [head];
  return [head, { role: 'assistant', content: soFar }, { role: 'user', content: CONTINUE_INSTRUCTION }];
}

export async function generateNovel({
  transcript,
  hasImages = false,
  pov,
  apiKey,
  fetchImpl = fetch,
  maxContinuations = NOVELIZE_MAX_CONTINUATIONS,
  timeoutMs = NOVELIZE_UPSTREAM_TIMEOUT_MS,
}) {
  const system = buildNovelizeSystemPrompt(pov) + (hasImages ? MARKER_INSTRUCTION : '');
  const parts = [];

  for (let attempt = 0; attempt <= maxContinuations; attempt += 1) {
    const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: NOVELIZE_MAX_TOKENS,
        thinking: { type: 'disabled' },
        system,
        messages: buildMessages(transcript, parts.join('')),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '');
      throw new Error(`upstream request failed: ${t.slice(0, 200)}`);
    }
    const data = await upstream.json();
    const text = extractText(data.content);
    // 継続の途中であっても、本文が空なら書き足すべき材料がない。部分的な結果を
    // 返さず失敗させ、再実行に委ねる。
    if (!text) throw new Error('novelization produced empty output; not saved');
    parts.push(text);

    if (data.stop_reason !== 'max_tokens') {
      return { text: parts.join(''), truncated: false };
    }
  }

  // 上限まで継続しても終わらなかった。生成済みの本文は捨てず、未完として返す。
  return { text: parts.join(''), truncated: true };
}
