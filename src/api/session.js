import { callTextModel, extractText, extractToolUse, parseJsonLoose } from './client.js';
import { resolveAdapter } from './prompts.js';

export async function summarizeWorld(raw) {
  const data = await callTextModel('summarize-world', { raw });
  return extractText(data.content).trim();
}

export async function generateScenario(genre, pcRaw, worldSummary) {
  const data = await callTextModel('generate-scenario', { genre, pcRaw, worldSummary });
  if (data.stop_reason === 'max_tokens') {
    throw new Error('シナリオ生成が途中で打ち切られました(max_tokens)。再試行してください。');
  }
  return extractText(data.content).trim();
}

// structured outputsのスキーマ上flagsは{key, value}の配列で返るため、既存の
// state管理(オブジェクトマージ)に合わせて変換する。
function normalizeFlags(result) {
  const flags = result?.state_update?.flags;
  if (Array.isArray(flags)) {
    result.state_update.flags = Object.fromEntries(flags.map((f) => [f.key, f.value]));
  }
  return result;
}

// allowRoll: このターンでroll_checkを許すか。導入シーンのように判定対象の行動が
// 存在しないターンではfalseで呼ぶ。ツールを開けたままにすると、モデルは判定が不要でも
// 「ダミー」「判定不要」といった中身のない見出しでroll_checkを1回消費し、その見出しが
// 判定スタンプとして場面の先頭に描かれてしまう。
export async function takeTurn(session, playerText, { allowRoll = true } = {}) {
  const adapter = resolveAdapter(session);
  let data = await callTextModel('take-turn', { session, playerText, allowRoll });
  let roll = null;
  let resourceChange = null;

  const toolUse = extractToolUse(data.content);
  if (toolUse && toolUse.name === 'roll_check') {
    roll = adapter.evaluate(toolUse.input.success_percent);
    roll.check_label = toolUse.input.check_label;

    // 副作用(SAN減少等)。発火はAIのcheck_kind指定、減少量はアダプタが決定論的に解決する。
    // sessionは破壊的変更せず、clamp後の実効deltaをresourceChangeとして呼び出し元へ返す。
    const eff = adapter.sideEffect(toolUse.input.check_kind || 'normal', roll.degree);
    const res = eff ? session.state.resources?.[eff.key] : null;
    if (eff && res) {
      const def = adapter.resourceDefs.find((d) => d.key === eff.key);
      const before = res.value;
      const after = Math.max(0, Math.min(res.max, before + eff.delta));
      resourceChange = { key: eff.key, label: def?.label || eff.key, delta: after - before, before, after };
      roll.resourceChange = resourceChange;
    }

    const payload = { roll: roll.roll, success: roll.success, degree: roll.degree };
    if (typeof roll.margin === 'number') payload.margin = roll.margin;
    if (resourceChange) {
      payload.san_loss = -resourceChange.delta;
      payload.san_now = resourceChange.after;
      if (resourceChange.after === 0) payload.note = '正気を完全に失った。狂気に呑まれる描写をせよ。';
    }

    // 判定は1ターンに最大1回。ここでツールを開けたままにすると、モデルは判定結果を
    // 受け取った後さらにroll_checkを呼びつつ、structured outputsのスキーマを満たす
    // ためだけの空JSON(narrative空・choices空)を添えて返すことがある。その2度目の
    // 呼び出しは下の1回きりの分岐では拾われず、空JSONがそのままターンの内容として
    // 表示される。tool_choice:noneで追撃時のツールを閉じ、本文の生成を必ず終わらせる。
    data = await callTextModel('take-turn', {
      session,
      playerText,
      allowRoll,
      continuation: { assistantContent: data.content, toolResult: payload },
    });
  }

  const text = extractText(data.content);
  const result = normalizeFlags(parseJsonLoose(text));
  return { result, roll, resourceChange };
}

// PC視点のオンデマンド回想。生フラグはLLMへの入力に留め、プレイヤーには自然な日本語のみ返す。
export async function recallMemory(session) {
  const data = await callTextModel('recall-memory', { session });
  return extractText(data.content).trim() || '(まだ特に思い出すことはない)';
}

// キャンペーン章末の引き継ぎ。既存PCシートへ冒険の成果を織り込んだ更新版と、持ち越しxpを返す。
export async function advanceCampaignPc(session) {
  const data = await callTextModel('advance-campaign-pc', { session });
  const pcRaw = extractText(data.content).trim() || session.pc?.raw || '';
  return { pcRaw, xp: session.state?.xp || 0 };
}
