import { generateText } from './textProvider.js';

const CAMPAIGN_GENERATION_TIMEOUT_MS = 120000;

const CHANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'target_id',
    'title',
    'details',
    'status',
    'progress',
    'visibility',
    'reason',
    'source_log_indexes',
  ],
  properties: {
    kind: {
      type: 'string',
      enum: [
        'canon_fact_add',
        'character_upsert',
        'faction_upsert',
        'timeline_upsert',
        'thread_open',
        'thread_resolve',
      ],
    },
    target_id: {
      type: 'string',
      description: '既存項目更新時はそのid。新規項目なら空文字',
    },
    title: { type: 'string' },
    details: { type: 'string' },
    status: { type: 'string' },
    progress: { type: 'integer' },
    visibility: { type: 'string', enum: ['all', 'gm'] },
    reason: { type: 'string' },
    source_log_indexes: { type: 'array', items: { type: 'integer' } },
  },
};

const RECONCILE_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'proposed_pc_raw', 'changes'],
    properties: {
      summary: { type: 'string' },
      proposed_pc_raw: { type: 'string' },
      proposed_pcs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'character_name', 'raw', 'xp'],
          properties: {
            id: { type: 'string' },
            character_name: { type: 'string' },
            raw: { type: 'string' },
            xp: { type: 'integer' },
          },
        },
      },
      changes: { type: 'array', items: CHANGE_SCHEMA },
    },
  },
};

const PITCH_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['pitches'],
    properties: {
      pitches: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'hook',
            'central_conflict',
            'involved_characters',
            'threads',
            'timeline_effects',
            'continuity_reasons',
            'tone',
            'estimated_length',
            'consistency_notes',
          ],
          properties: {
            title: { type: 'string' },
            hook: { type: 'string' },
            central_conflict: { type: 'string' },
            involved_characters: { type: 'array', items: { type: 'string' } },
            threads: { type: 'array', items: { type: 'string' } },
            timeline_effects: { type: 'array', items: { type: 'string' } },
            continuity_reasons: { type: 'array', items: { type: 'string' } },
            tone: { type: 'string' },
            estimated_length: { type: 'string' },
            consistency_notes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
};

function extractText(content) {
  return (content || [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function transcriptOf(session) {
  return (session.log || [])
    .map((entry, index) => {
      const role = entry.role === 'player'
        ? entry.source === 'auto' ? 'AI同行' : 'PL'
        : 'GM';
      const actor = entry.characterName ? `(${entry.characterName})` : '';
      const roll = entry.roll
        ? ` [判定: ${entry.roll.check_label || entry.roll.checkLabel || ''} ${entry.roll.roll ?? ''} ${entry.roll.degree || ''}]`
        : '';
      const reason = entry.source === 'auto' && entry.reason ? ` [理由: ${entry.reason}]` : '';
      return `[${index}] ${role}${actor}: ${entry.text || ''}${roll}${reason}`;
    })
    .join('\n');
}

function sourcesText(sources) {
  return `# Campaign原典\n${sources.bible || '(未設定)'}\n\n# 主要人物・勢力の初期設定\n${
    sources.cast || '(未設定)'
  }\n\n# PCが介入しない場合の予定事件\n${sources.timeline || '(未設定)'}`;
}

async function callStructured({ apiKey, model, fetchImpl, system, user, format, maxTokens }) {
  const data = await generateText({
    apiKey,
    model,
    fetchImpl,
    timeoutMs: CAMPAIGN_GENERATION_TIMEOUT_MS,
    request: {
      max_tokens: maxTokens,
      system,
      output_config: { format },
      messages: [{ role: 'user', content: user }],
    },
  });
  if (data.stop_reason === 'max_tokens') throw new Error('campaign generation was truncated');
  return JSON.parse(extractText(data.content));
}

export async function reconcileCampaignChapter({
  campaign,
  sources,
  worldRaw,
  session,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  return callStructured({
    apiKey,
    model,
    fetchImpl,
    maxTokens: 6000,
    format: RECONCILE_FORMAT,
    system: `あなたはTRPGキャンペーンの記録編集者。終了した一章の全ログを読み、次話へ持ち越す正史更新案を作る。

# 最重要ルール
- ログで実際に起きたことだけをプレイ結果として扱う。
- Campaign原典をプレイ結果でなかったことにしない。ただしプレイ結果により予定が阻止・延期・変質したことは提案する。
- AIの解釈はまだ正史ではない。GMが項目ごとに確認できる短い変更案へ分ける。
- target_idは現在状態の既存項目を更新・解決する場合だけ既存idを使い、新規なら空文字。
- timeline_upsertはPCが介入しなかった場合の予定事件の現在状態として整理する。statusはpending/advanced/prevented/delayed/transformed/completedを優先する。
- thread_resolveは現在状態にある未解決事項を解決した場合だけ使う。
- source_log_indexesへ根拠となるログ番号を入れる。
- proposed_pc_rawは元シートの体裁を保ち、獲得物・成長・関係変化だけを反映する。未開示のGM情報や内部フラグ名を含めない。
- Party Sessionではproposed_pcsへ全PCを同じ順序で返し、PC別resources・conditions・人間行動とAI同行行動を区別して反映する。proposed_pc_rawは先頭PCと同じ本文にする。
- 説明やMarkdownコードブロックを付けず、指定JSONだけを返す。`,
    user: `${sourcesText(sources)}

# World
${worldRaw || '(未設定)'}

# 現在のCampaign正史
${JSON.stringify(campaign.currentState || {}, null, 2)}

# 対象Scenario
${session.scenario?.raw || '(未設定)'}

# 元のPCシート
${session.pc?.raw || '(未設定)'}

# Party全PC設定
${JSON.stringify(session.pcs || [], null, 2)}

# 最終state
${JSON.stringify(session.state || {}, null, 2)}

# セッション全ログ
${transcriptOf(session) || '(ログなし)'}`,
  });
}

export async function generateCampaignPitches({
  campaign,
  sources,
  worldRaw,
  requestText,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  return callStructured({
    apiKey,
    model,
    fetchImpl,
    maxTokens: 5000,
    format: PITCH_FORMAT,
    system: `あなたは連作TRPGのシナリオ構成者。Campaign原典とGM承認済み正史から、次話候補を2〜3案作る。

# 優先順位
1. Campaign原典の固定事項
2. GM承認済み正史
3. 現在の人物・勢力・予定事件・未解決事項
4. 引き継ぎPC
5. 今回のGM要望

- 死亡・離反・破壊・公開済み秘密など、前話の結果を無かったことにしない。
- 候補ごとに違う遊び味を出す。
- 原典や正史との整合性に注意が要る点はconsistency_notesへ明記する。
- 指定JSONだけを返す。`,
    user: `${sourcesText(sources)}

# World
${worldRaw || '(未設定)'}

# GM承認済み正史
${JSON.stringify(campaign.currentState || {}, null, 2)}

# 引き継ぎPC
${JSON.stringify(campaign.carriedPcs?.length ? campaign.carriedPcs : [campaign.carriedPc], null, 2)}

# 章履歴
${JSON.stringify(campaign.chapters || [], null, 2)}

# 今回の要望
${requestText || '(指定なし)'}`,
  });
}

export async function generateCampaignScenario({
  campaign,
  sources,
  worldRaw,
  pitch,
  instructions,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  const data = await generateText({
    apiKey,
    model,
    fetchImpl,
    timeoutMs: CAMPAIGN_GENERATION_TIMEOUT_MS,
    request: {
      max_tokens: 8000,
      system: `あなたは連作TRPGのシナリオ作家。選択された次話候補を、実際にAI GMが進行できる完全なScenarioへ展開する。

# 最重要ルール
- Campaign原典とGM承認済み正史をsource of truthとする。
- 前話の結果を無効化しない。死亡者を説明なく再登場させず、公開済み秘密を再び未発見扱いにしない。
- PCの行動・結末を事前に固定しない。複数の解決経路とfail forwardを用意する。
- 出力はMarkdown本文だけ。コードブロックや前置きを付けない。

# 見出し
## シナリオ概要
## GM専用情報
## 章構成

章構成には導入、重要人物、手掛かりまたは対立、分岐、クライマックス条件、複数の結末条件を含める。`,
      messages: [
        {
          role: 'user',
          content: `${sourcesText(sources)}

# World
${worldRaw || '(未設定)'}

# GM承認済み正史
${JSON.stringify(campaign.currentState || {}, null, 2)}

# 引き継ぎPC
${JSON.stringify(campaign.carriedPcs?.length ? campaign.carriedPcs : [campaign.carriedPc], null, 2)}

# 選択した次話候補
${JSON.stringify(pitch, null, 2)}

# 追加指定
${instructions || '(指定なし)'}`,
        },
      ],
    },
  });
  if (data.stop_reason === 'max_tokens') throw new Error('scenario generation was truncated');
  const raw = extractText(data.content).replace(/```(?:markdown)?/gi, '').replace(/```/g, '').trim();
  if (!raw) throw new Error('scenario generation returned empty text');
  return { title: String(pitch?.title || '次の章').trim() || '次の章', raw };
}
