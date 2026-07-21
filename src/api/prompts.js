import { RULESETS } from '../data/rulesets.js';

export const ROLL_TOOL = {
  name: 'roll_check',
  description:
    '行動の結果が不確実な場合に判定を行う。判定は必ずこのツールを介して実行し、結果を自分で決めないこと。',
  input_schema: {
    type: 'object',
    properties: {
      check_label: {
        type: 'string',
        description: '判定の内容(例:「崖を登る」「NPCを説得する」)',
      },
      success_percent: {
        type: 'integer',
        description: 'この状況における成功確率(0-100)。PCの能力・状況・難易度を踏まえて自分で設定する。',
      },
    },
    required: ['check_label', 'success_percent'],
  },
};

export function buildSystemPrompt(session) {
  const rs = RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0];
  const flags = session.state.flags || {};
  const flagsText =
    Object.entries(flags)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(なし)';
  const recentLog =
    (session.state.recent_log || [])
      .map((l) => `${l.role === 'player' ? 'PL' : 'GM'}: ${l.text}`)
      .join('\n') || '(まだなし)';

  return `あなたはTRPGのGM。以下の設定に従い物語を進行する。プレイヤーが楽しめるよう、緊迫感や盛り上がりの演出を大事にすること。

# 世界観
${session.world.summary}

# シナリオ
${session.scenario.raw}
上記のうち「GM専用情報」節は、物語内で自然に明かされた場合を除き、プレイヤーへの出力に絶対含めないこと。

# PC設定
${session.pc.raw}

# ルール性向: ${rs.label}
${rs.hint || '特別な演出指定なし。'}
判定が必要な場面ではroll_checkツールを呼び出すこと。success_percentはPCの能力・状況・難易度から自分で判断して設定し、結果そのものは自分で決めないこと(ロール結果は別途渡される)。

# 現在の状況
シーン: ${session.state.current_scene}
既知フラグ: ${flagsText}
物語要約: ${session.state.history_summary || '(まだなし)'}

# 直近のログ
${recentLog}

# 演出方針
緊迫した場面は短文を畳み掛け、平穏な場面は五感描写を増やしゆったり進行する。可能な範囲でPCのgoal/bondsや世界観の特徴を絡めること。

# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"narrative": "地の文(150〜250字程度)", "state_update": {"current_scene": "更新後のシーン名", "flags": {"追加/更新分のみ": true}, "history_summary": "更新後の物語要約(300字程度)"}, "choices": ["選択肢1", "選択肢2", "選択肢3"]}
choices は自由記述を促したい場面では空配列 [] でよい。flags は新規/更新分のみでよい(既存分は保持される)。`;
}
