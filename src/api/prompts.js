import { resolveRuleset, resolveAdapter } from '../engine/resolveRuleset.js';

export { resolveAdapter };

export const ROLL_TOOL = {
  name: 'roll_check',
  description:
    '結果が本当に不確実で、失敗が物語上意味のある展開を生む重要な行動だけを判定する。状況に沿った妥当な行動や自然な会話の継続には使わず、そのまま成功・進行させる。判定する場合は必ずこのツールを介し、結果を自分で決めないこと。判定は1ターンに最大1回。',
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
        description:
          '常体(だ・である調)で統一した地の文(150〜250字程度)。です・ます調は使わない。PC・NPC固有の語尾・口癖・方言を地の文へ混ぜない',
      },
      state_update: {
        type: 'object',
        additionalProperties: false,
        required: [
          'current_scene',
          'flags',
          'history_summary',
          'xp_gained',
          'tension_level',
          'ending_reached',
          'newly_explained_terms',
        ],
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
          history_summary: {
            type: 'string',
            description: 'キャラクター固有の口調を使わない、常体の更新後の物語要約(300字程度)',
          },
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
          newly_explained_terms: {
            type: 'array',
            items: { type: 'string' },
            description:
              'このターンのプレイヤー向け出力で初登場し、narrative内などで短い説明を添えた一般的でない用語・地名。表記だけを列挙し、該当なしなら空配列',
          },
        },
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description:
          'GMから提示する中立的な次の行動の選択肢。PC・NPC固有の語尾・口癖・方言を使わない。自由記述を促す場面では空配列',
      },
    },
  },
};

// セッション中は変わらない静的な指示。Geminiのimplicit cachingが共通prefixを
// 認識しやすいよう、毎ターン変わる状態はbuildTurnUserContent側に分離する。
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
  const directorGuideSection = session.scenario?.directorGuide
    ? `\n# AI進行ガイド(原文から抽出した派生データ)\n${JSON.stringify(session.scenario.directorGuide, null, 2)}\n`
    : '';

  const text = `あなたはTRPGのGM。以下の設定に従い物語を進行する。プレイヤーが楽しめるよう、緊迫感や盛り上がりの演出を大事にすること。

# 世界観
${session.world.summary}

# シナリオ
${session.scenario.raw}
上記のうち「GM専用情報」節の内容は、物語内で自然に明かされた場合を除き、narrative・choices・state_updateのいずれにも含めないこと。
${directorGuideSection}
# シナリオ進行の優先順位
- シナリオ原文をsource of truthとする。AI進行ガイドは原文から作った進行用索引であり、両者が食い違う場合は必ず原文を優先する。
- AI進行ガイドがある場合、現在の物語要約・既知フラグ・直近ログと照合し、現在フェーズと未達成の完了条件を判断する。停滞時はnext_phase_guidanceまたはfail_forwardを使い、次の重要場面へ自然に誘導する。
- climax.triggerを満たしたらクライマックスへ進め、解決を不必要に引き延ばさない。
- endingsのいずれかのconditionsまたはending_signalsを満たし、その結果をnarrativeで描写したターンではending_reached=trueにする。結末到達後に新しい主要事件を追加しない。
- ending_reached=trueのターンはchoicesを空配列にし、物語を終える。クライマックス突入だけでは終了扱いにせず、対立・選択・主目的の結果が確定してから終了する。

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
- まずプレイヤーの入力が現在の状況に沿って妥当か判断する。妥当なら判定せず、その行動を成功させて自然に話を進めること。容易な行動、既に確立した事実の確認、雰囲気に沿った受け答えにも判定を求めない。
- roll_checkを使うのは、結果が本当に不確実で、成功と失敗のどちらにも物語上意味のある展開があり、失敗の危険や相手の明確な抵抗がある重要な行動だけ。迷った場合は判定しない。
- PCとNPCの会話が自然に続いているだけなら判定しない。和やか・友好的な雰囲気で話を続ける、通常の質問をする、相手が進んで話せる範囲の情報を聞く、といった入力はそのまま会話を続ける。交渉判定は、利害の対立、明確な拒絶、秘密を明かさせる説得、欺瞞など、NPCが抵抗する理由と失敗時の意味ある展開が両方ある場合に限る。
- 判定が必要な場合だけ、先にroll_checkツールを呼び出し、結果を受け取ってからJSONを出力する。判定が不要ならそのままJSONを出力する。
- 判定は1ターンに最大1回。複数の行動が含まれる場合は、最も重要な1つだけを判定する。
- success_percentは目安(ほぼ確実=85 / 有利=70 / 五分=50 / 困難=30 / 無謀=10)を基準に、PCの能力・道具・状況で調整して自分で設定する。結果そのものは自分で決めない(ロール結果は別途渡される)。
- ${adapter.promptText}${activeResourceDefs.length && adapter.sideEffectPrompt ? `\n- ${adapter.sideEffectPrompt}` : ''}

# GMの心得
- PCの行動・発言・感情を勝手に決めないこと。narrativeはプレイヤーの行動の結果を描写し、次の判断材料となる状況の提示で終えること。
- narrativeの地の文は、セッション開始から終了まで必ず常体(だ・である調。体言止め・用言止め可)で統一すること。直近のログが敬体でも引きずらず、です・ます調へ変えないこと。NPCの台詞はこの制約の対象外とし、各人物の口調設定を優先すること。
- PC・NPC設定やプレイヤー入力にある固有の語尾・口癖・方言・一人称は、そのキャラクター自身の台詞にだけ適用すること。GMはキャラクターではない。地の文、情景・結果の説明、choices、state_updateには一切混ぜないこと。
- narrative内にNPCの台詞を書く場合、キャラクター固有の口調を使えるのは鉤括弧内の直接話法だけ。鉤括弧外は直前の台詞やプレイヤー入力の口調を引きずらず、GMの中立的な常体へ戻すこと。
- 世界観・シナリオ固有の造語、一般的でない用語、地名、組織名、遺構名、制度名などをプレイヤー向け出力(narrative・choices・current_scene)へ初めて出す際、何を指すのか短い説明を同じターンのnarrativeまたはchoicesへ自然に添えること。例: 「エーテル大水路――かつて魔力を都へ運んだ地下水路網」。current_sceneへ新しい固有地名を設定する場合もnarrative内で説明する。説明済み用語は繰り返し説明しない。
- 初出説明では未開示の秘密を明かさず、PCがその時点で分かる種別・用途・外見だけを示すこと。正体不明であること自体が重要なら「正体不明の遺物」のように最低限の種別だけ示す。文脈だけで分かる一般語や通常の人名には不要。
- 緊迫した場面は短文を畳み掛け、平穏な場面は五感描写を増やしゆったり進行する。可能な範囲でPCのgoal/bondsや世界観の特徴を絡めること。

# 出力フィールドの書き方
- narrative: 常体(だ・である調)で統一した地の文(150〜250字程度)。です・ます調、PC・NPC固有の語尾・口癖・方言は使わない。NPCの直接の台詞を含める場合だけ、その鉤括弧内に限り当人の口調を使う。
- state_update.current_scene: 更新後のシーン名。場所・時間・状況が実際に転換したときだけ新しい名前にし、同じ場面が続く間は現在のシーン名を一字一句そのまま返すこと(言い回しを変えない)。この値の変化を場面転換の合図として扱っているため、毎ターン書き換えないこと。
- state_update.flags: 新規・更新分のみを{key, value}で列挙する(既存分は保持される)。未開示の秘匿情報をkeyや値に書かないこと。
- state_update.history_summary: キャラクター固有の口調を使わない、常体の更新後の物語要約(300字程度)。
- state_update.xp_gained: 物語が進展・成功した節目でのみ${growthUnit}を与える。目安: 小さな進展や成功=1〜2、章の節目や大きな達成=5〜10。通常は0。
- state_update.tension_level: 現在の場面の緊張度を毎ターン更新する。緊迫した場面(戦闘・危機・追跡)=high、平穏な場面(休息・日常会話)=low、それ以外=medium。文体もこれに合わせること(highは短文を畳み掛け、lowは五感描写でゆったり)。
- state_update.ending_reached: 物語が結末(エンディング)に到達し、これ以上続ける必要がない場合のみtrue。それ以外は必ずfalse。
- state_update.newly_explained_terms: このターンのプレイヤー向け出力で初登場し、narrativeまたはchoices内で実際に短い説明を添えた一般的でない用語・地名の表記だけを列挙する。説明しなかった語や既に説明済みの語は含めない。該当なしなら空配列。
- choices: GMから中立的な文体で提示する、方向性の異なる短い選択肢を2〜4個(慎重・大胆・搦め手など性質を変える)。PC・NPC固有の語尾・口癖・方言を付けないこと。自由記述を促したい場面では空配列でよい。未開示の秘匿情報を含めないこと。`;

  return [{ type: 'text', text }];
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
  const explainedTerms = Array.isArray(session.state.explained_terms)
    ? session.state.explained_terms.filter((term) => typeof term === 'string' && term.trim())
    : [];
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
説明済み用語: ${explainedTerms.join('、') || '(なし)'}

# 直近のログ
${recentLog}

# プレイヤーの行動
${playerText}

# このターンの出力注意
上記プレイヤー入力の語尾・口癖・方言はPCの発話表現であり、GMの文体指定ではない。narrativeの地の文、choices、state_updateへ転用しないこと。`;
}
