import { resolveRuleset, resolveAdapter } from '../engine/resolveRuleset.js';

export { resolveAdapter };

export const ROLL_TOOL = {
  name: 'roll_check',
  description:
    '行動の結果が不確実な場合に判定を行う。判定は必ずこのツールを介して実行し、結果を自分で決めないこと。判定は1ターンに最大1回。',
  input_schema: {
    type: 'object',
    properties: {
      check_label: {
        type: 'string',
        description: '判定の内容(例:「崖を登る」「NPCを説得する」)',
      },
      success_percent: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description:
          'この状況における成功確率(0-100)。目安: ほぼ確実=85 / 有利=70 / 五分=50 / 困難=30 / 無謀=10。PCの能力・道具・状況・難易度を踏まえて調整する。',
      },
    },
    required: ['check_label', 'success_percent'],
  },
};

// アダプタが副作用kind(sanity等)を持つ場合のみcheck_kindを受け付けるroll_checkを組み立てる。
export function buildRollTool(adapter) {
  if (!adapter?.sideEffectKinds?.length) return ROLL_TOOL;
  return {
    ...ROLL_TOOL,
    input_schema: {
      ...ROLL_TOOL.input_schema,
      properties: {
        ...ROLL_TOOL.input_schema.properties,
        check_kind: {
          type: 'string',
          enum: ['normal', ...adapter.sideEffectKinds],
          description: '判定の種別。恐怖・正気を試される場面ではsanity、それ以外はnormal(省略可)。',
        },
      },
    },
  };
}

// GMターン応答のstructured outputsスキーマ。
// flagsは自由キーのオブジェクトをスキーマで表現できないため{key, value}の配列で受け取り、
// takeTurn側でオブジェクトへ変換する。
export const TURN_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['narrative', 'state_update', 'choices'],
    properties: {
      narrative: {
        type: 'string',
        description: '地の文(150〜250字程度)',
      },
      state_update: {
        type: 'object',
        additionalProperties: false,
        required: ['current_scene', 'flags', 'history_summary', 'xp_gained', 'tension_level', 'ending_reached'],
        properties: {
          current_scene: {
            type: 'string',
            description: '更新後のシーン名。同じ場面が続く間は現在のシーン名をそのまま返す',
          },
          flags: {
            type: 'array',
            description: '新規・更新分のフラグのみ(既存分は保持される)',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'value'],
              properties: {
                key: { type: 'string' },
                value: {
                  anyOf: [{ type: 'boolean' }, { type: 'string' }, { type: 'number' }],
                },
              },
            },
          },
          history_summary: { type: 'string', description: '更新後の物語要約(300字程度)' },
          xp_gained: { type: 'integer', description: '今ターンで得た成長点。通常は0' },
          tension_level: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: '現在の場面の緊張度。緊迫・戦闘・危機=high、通常=medium、平穏・休息=low',
          },
          ending_reached: {
            type: 'boolean',
            description: '物語が結末(エンディング)に到達したならtrue。通常はfalse',
          },
        },
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: '次の行動の選択肢。自由記述を促す場面では空配列',
      },
    },
  },
};

// セッション中は変わらない静的な指示。cache_controlを付けてプロンプトキャッシュを効かせる。
// 毎ターン変わる状態(シーン・フラグ・要約・ログ)はbuildTurnUserContent側に置く。
export function buildSystemBlocks(session) {
  const rs = resolveRuleset(session);
  const adapter = resolveAdapter(session);
  const growthUnit = session.ruleset?.growthUnit || '経験値';
  // adapter.resourceDefsはformulaの解決だけで決まるが、実際にSAN等が機能するかは
  // セッションがstate.resourcesを持っているかに依存する(後方互換の既存セッションは持たない)。
  // プロンプトで約束する内容と実際に起きうる内容を一致させるため、実在するリソースだけに絞る。
  const sessionResources = session.state?.resources || {};
  const activeResourceDefs = adapter.resourceDefs.filter((d) => d.key in sessionResources);
  const pcGoalBondsSection =
    session.pc.goal || session.pc.bonds
      ? `\n# PCの目標・因縁(抽出済み)\ngoal: ${session.pc.goal || '(未設定)'}\nbonds: ${session.pc.bonds || '(未設定)'}\n`
      : '';

  const text = `あなたはTRPGのGM。以下の設定に従い物語を進行する。プレイヤーが楽しめるよう、緊迫感や盛り上がりの演出を大事にすること。

# 世界観
${session.world.summary}

# シナリオ
${session.scenario.raw}
上記のうち「GM専用情報」節の内容は、物語内で自然に明かされた場合を除き、narrative・choices・state_updateのいずれにも含めないこと。

# PC設定
${session.pc.raw}
${pcGoalBondsSection}
# ルール性向: ${rs.label}
${rs.hint || '特別な演出指定なし。'}
${
  activeResourceDefs.length
    ? `\n# リソース\n${activeResourceDefs
        .map((d) => `- ${d.label}: 最大${d.max}。現在値は毎ターンの「現在の状況」に示される。`)
        .join('\n')}\n`
    : ''
}
# 判定ルール
- 行動の結果が不確実な場面では、先にroll_checkツールを呼び出し、結果を受け取ってからJSONを出力すること。判定が不要ならそのままJSONを出力する。
- 判定は1ターンに最大1回。複数の行動が含まれる場合は、最も重要な1つだけを判定する。
- success_percentは目安(ほぼ確実=85 / 有利=70 / 五分=50 / 困難=30 / 無謀=10)を基準に、PCの能力・道具・状況で調整して自分で設定する。結果そのものは自分で決めない(ロール結果は別途渡される)。
- ${adapter.promptText}${activeResourceDefs.length && adapter.sideEffectPrompt ? `\n- ${adapter.sideEffectPrompt}` : ''}

# GMの心得
- PCの行動・発言・感情を勝手に決めないこと。narrativeはプレイヤーの行動の結果を描写し、次の判断材料となる状況の提示で終えること。
- 緊迫した場面は短文を畳み掛け、平穏な場面は五感描写を増やしゆったり進行する。可能な範囲でPCのgoal/bondsや世界観の特徴を絡めること。

# 出力フィールドの書き方
- narrative: 地の文(150〜250字程度)。
- state_update.current_scene: 更新後のシーン名。場所・時間・状況が実際に転換したときだけ新しい名前にし、同じ場面が続く間は現在のシーン名を一字一句そのまま返すこと(言い回しを変えない)。この値の変化を場面転換の合図として扱っているため、毎ターン書き換えないこと。
- state_update.flags: 新規・更新分のみを{key, value}で列挙する(既存分は保持される)。未開示の秘匿情報をkeyや値に書かないこと。
- state_update.history_summary: 更新後の物語要約(300字程度)。
- state_update.xp_gained: 物語が進展・成功した節目でのみ${growthUnit}を与える。目安: 小さな進展や成功=1〜2、章の節目や大きな達成=5〜10。通常は0。
- state_update.tension_level: 現在の場面の緊張度を毎ターン更新する。緊迫した場面(戦闘・危機・追跡)=high、平穏な場面(休息・日常会話)=low、それ以外=medium。文体もこれに合わせること(highは短文を畳み掛け、lowは五感描写でゆったり)。
- state_update.ending_reached: 物語が結末(エンディング)に到達し、これ以上続ける必要がない場合のみtrue。それ以外は必ずfalse。
- choices: 方向性の異なる短い選択肢を2〜4個(慎重・大胆・搦め手など性質を変える)。自由記述を促したい場面では空配列でよい。未開示の秘匿情報を含めないこと。`;

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

// 毎ターン変わる状態+プレイヤー入力。userメッセージとして送る。
export function buildTurnUserContent(session, playerText) {
  const flags = session.state.flags || {};
  const flagsText =
    Object.entries(flags)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(なし)';
  const recentLog =
    (session.state.recent_log || [])
      .map((l) => `${l.role === 'player' ? 'PL' : 'GM'}: ${l.text}`)
      .join('\n') || '(まだなし)';
  const adapter = resolveAdapter(session);
  const resources = session.state.resources || {};
  const resourceLine = Object.keys(resources).length
    ? `\nリソース: ${Object.entries(resources)
        .map(([k, r]) => `${adapter.resourceDefs.find((d) => d.key === k)?.label || k} ${r.value}/${r.max}`)
        .join(', ')}`
    : '';

  return `# 現在の状況
シーン: ${session.state.current_scene}
テンション: ${session.state.tension_level || 'medium'}${resourceLine}
既知フラグ: ${flagsText}
物語要約: ${session.state.history_summary || '(まだなし)'}

# 直近のログ
${recentLog}

# プレイヤーの行動
${playerText}`;
}
