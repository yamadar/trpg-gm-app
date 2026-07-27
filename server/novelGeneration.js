// セッションログから小説本文を生成する。出力上限で切れた場合は継続リクエストで
// 書き足させ、完結した本文を返す。ジョブの状態管理は novelJobs.js の責務。
import { generateText } from './textProvider.js';

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
  '直前の出力は出力上限に達して途中で切れている。切れた箇所の直後から、自然につながるように本文を書き続けよ。地の文は常体(だ・である調)を維持し、です・ます調へ変えないこと。すでに書いた部分を繰り返したり要約したりしないこと。「続き」などの前置きや説明文は一切付けず、小説本文のみを出力すること。';

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// 主人公と他の人物がどちらも「彼」になり、読者が取り違える事故を防ぐための規律。
// トランスクリプトのGM地の文はPCを二人称で呼ぶため、三人称へ書き直す時点で
// モデルに使える語が「彼」しか残らない。指示がないと衝突は構造的に必ず起きる。
const CAST_RULES_COMMON = `- 一つの段落の中で、二人以上の人物を「彼」「彼女」で受けないこと。片方は必ず名前、または立場・特徴による固有の呼称で書くこと。
- 会話の応酬では、どの台詞・動作が誰のものかが常に一意に定まるように書くこと。`;

// トランスクリプトには実はPCの名前が入っていることが多い(PL行やNPCの呼びかけ)。
// 「名前は存在しない」と断言すると、使える名前を無視して余計な呼称を作らせてしまうため、
// 「読み取れるなら使う」を先に指示し、読み取れない場合の代替(固定の呼び名)を続ける。
const NAMELESS_PC_RULE =
  '- 主人公の名前は与えられていない。ログから読み取れるならその名前を使い、読み取れなければ世界観に合う呼称(「その傭兵」のような固定の呼び名)を一つだけ定めること。いずれの場合も全編を通して一貫して使い、場面ごとに呼び方を変えないこと。';

// 一人称では主人公は「私」等になり他の人物と衝突しないため、主人公の行は出さない。
function buildCastRules(pov, pcName) {
  const lines =
    pov === 'first'
      ? [CAST_RULES_COMMON]
      : [
          pcName
            ? `- 主人公の名前は「${pcName}」である。地の文では原則この名前で呼び、代名詞は直前の主語が明白なときだけ使うこと。`
            : NAMELESS_PC_RULE,
          CAST_RULES_COMMON,
        ];
  return `\n\n# 人物の書き分け\n${lines.join('\n')}`;
}

// pov: 'third'(既定)または 'first'。pcName が空なら呼称をモデルに決めさせる。
function buildNovelizeSystemPrompt(pov, pcName) {
  const voice = pov === 'first' ? 'PC視点の一人称' : '三人称';
  return (
    `以下はTRPGセッションの進行ログである。プレイヤー発言とGMの地の文が交互に並んでいる。これを${voice}の小説として、場面転換や心理描写を補いながら自然な文章に書き直せ。小説の地の文は全編を通して必ず常体(だ・である調。体言止め・用言止め可)で統一し、進行ログが敬体でも引きずらず、です・ます調へ変えないこと。登場人物の台詞はこの制約の対象外とし、各人物の口調を優先すること。ゲーム的な表現(選択肢・判定結果の数値等)はそのまま出力せず、物語として自然に溶け込ませること。説明文やコードブロック記号は付けず、小説本文のみを出力すること。` +
    buildCastRules(pov, pcName)
  );
}

// トランスクリプトを常に先頭へ置き、Geminiのimplicit cachingが共通prefixを
// 認識しやすくする。
function transcriptMessage(transcript) {
  return {
    role: 'user',
    content: [{ type: 'text', text: transcript }],
  };
}

// これまでの出力は完了済みmodelターンとして置き、末尾をuserターンの
// 継続指示にする。最終modelターンのprefillに依存しない会話履歴になる。
function buildMessages(transcript, soFar) {
  const head = transcriptMessage(transcript);
  if (!soFar) return [head];
  return [head, { role: 'assistant', content: soFar }, { role: 'user', content: CONTINUE_INSTRUCTION }];
}

export async function generateNovel({
  transcript,
  hasImages = false,
  pcName = '',
  pov,
  apiKey,
  model,
  fetchImpl = fetch,
  maxContinuations = NOVELIZE_MAX_CONTINUATIONS,
  timeoutMs = NOVELIZE_UPSTREAM_TIMEOUT_MS,
}) {
  const system = buildNovelizeSystemPrompt(pov, pcName) + (hasImages ? MARKER_INSTRUCTION : '');
  const parts = [];

  for (let attempt = 0; attempt <= maxContinuations; attempt += 1) {
    const data = await generateText({
      apiKey,
      model,
      fetchImpl,
      timeoutMs,
      request: {
        max_tokens: NOVELIZE_MAX_TOKENS,
        system,
        messages: buildMessages(transcript, parts.join('')),
      },
    });
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
