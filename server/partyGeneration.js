import { generateText } from './textProvider.js';
import { getAdapter } from '../src/engine/rulesetAdapters.js';

const PARTY_TIMEOUT_MS = 120000;

const PLAN_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['resolution', 'decisionQuestion', 'decisionOptions', 'checks', 'autoActions'],
    properties: {
      resolution: { type: 'string', enum: ['advance', 'decision_required'] },
      decisionQuestion: { type: 'string' },
      decisionOptions: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'description'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pcId', 'checkLabel', 'successPercent', 'checkKind', 'supportPcIds'],
          properties: {
            pcId: { type: 'string' },
            checkLabel: { type: 'string' },
            successPercent: { type: 'integer' },
            checkKind: { type: 'string', enum: ['normal', 'sanity'] },
            supportPcIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      autoActions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pcId', 'text', 'reason'],
          properties: {
            pcId: { type: 'string' },
            text: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
};

const OUTCOME_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['globalUpdate', 'sceneUpdates', 'pcUpdates', 'narratives', 'choicesByPc', 'autoActions'],
    properties: {
      globalUpdate: {
        type: 'object',
        additionalProperties: false,
        required: ['time', 'historySummary', 'tensionLevel', 'endingReached', 'flagUpdates'],
        properties: {
          time: { type: 'string' },
          historySummary: { type: 'string' },
          tensionLevel: { type: 'integer' },
          endingReached: { type: 'boolean' },
          flagUpdates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'value'],
              properties: { key: { type: 'string' }, value: { type: 'string' } },
            },
          },
        },
      },
      sceneUpdates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sceneId', 'title', 'location', 'participantPcIds', 'summary'],
          properties: {
            sceneId: { type: 'string' },
            title: { type: 'string' },
            location: { type: 'string' },
            participantPcIds: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
        },
      },
      pcUpdates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pcId', 'sceneId', 'conditionChanges', 'newlyKnownFactIds'],
          properties: {
            pcId: { type: 'string' },
            sceneId: { type: 'string' },
            conditionChanges: { type: 'array', items: { type: 'string' } },
            newlyKnownFactIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      narratives: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'audienceKind', 'audienceIds', 'text'],
          properties: {
            id: { type: 'string' },
            audienceKind: { type: 'string', enum: ['all', 'scene', 'pcs'] },
            audienceIds: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' },
          },
        },
      },
      choicesByPc: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pcId', 'choices'],
          properties: {
            pcId: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      autoActions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pcId', 'text', 'reason'],
          properties: {
            pcId: { type: 'string' },
            text: { type: 'string' },
            reason: { type: 'string' },
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

async function structuredCall({ apiKey, model, fetchImpl, system, user, format, maxTokens }) {
  const data = await generateText({
    apiKey,
    model,
    fetchImpl,
    timeoutMs: PARTY_TIMEOUT_MS,
    request: {
      max_tokens: maxTokens,
      system,
      output_config: { format },
      messages: [{ role: 'user', content: user }],
    },
  });
  if (data.stop_reason === 'max_tokens') throw new Error('party generation was truncated');
  const text = extractText(data.content);
  if (!text) throw new Error('party generation returned empty text');
  return JSON.parse(text);
}

function contextText({ session, snapshot, round, decisionResult }) {
  const actions = (round.resolutionIntents || round.intents || []).map((intent) => ({
    pcId: intent.pcId,
    characterName: intent.characterName,
    text: intent.text,
    source: intent.source || 'human',
  }));
  return `# World\n${session.gmSnapshot.world?.raw || session.gmSnapshot.world?.summary || '(未設定)'}

# Scenario（GM専用）\n${session.gmSnapshot.scenario?.raw || '(未設定)'}

# Scenario進行ガイド\n${JSON.stringify(session.gmSnapshot.directorGuide || {}, null, 2)}

# PC一覧\n${JSON.stringify(session.pcs, null, 2)}

# 共有state\n${JSON.stringify({ global: snapshot.global, scenes: snapshot.scenes, pcs: snapshot.pcs }, null, 2)}

# 今回の行動\n${JSON.stringify(actions, null, 2)}

# 投票で確定した決定\n${decisionResult ? JSON.stringify(decisionResult, null, 2) : '(なし)'}`;
}

function normalizePlan(plan, session) {
  const pcIds = new Set(session.pcs.map((pc) => pc.id));
  const seen = new Set();
  const checks = (plan.checks || []).filter((check) => {
    if (!pcIds.has(check.pcId) || seen.has(check.pcId)) return false;
    seen.add(check.pcId);
    return true;
  }).slice(0, session.pcs.length).map((check) => ({
    pcId: check.pcId,
    checkLabel: String(check.checkLabel || '判定').slice(0, 200),
    successPercent: Math.max(1, Math.min(99, Math.round(check.successPercent || 50))),
    checkKind: check.checkKind === 'sanity' ? 'sanity' : 'normal',
    supportPcIds: (check.supportPcIds || []).filter((id) => pcIds.has(id) && id !== check.pcId),
  }));
  const options = (plan.decisionOptions || []).slice(0, 4).map((option, index) => ({
    id: `option_${index + 1}`,
    label: String(option.label || `案${index + 1}`).slice(0, 200),
    description: String(option.description || '').slice(0, 1000),
  }));
  return {
    resolution: plan.resolution === 'decision_required' && options.length >= 2
      ? 'decision_required'
      : 'advance',
    decisionQuestion: String(plan.decisionQuestion || '').slice(0, 1000),
    decisionOptions: options,
    checks,
    autoActions: (plan.autoActions || []).filter((item) => pcIds.has(item.pcId)).map((item) => ({
      pcId: item.pcId,
      text: String(item.text || '').slice(0, 1000),
      reason: String(item.reason || '').slice(0, 500),
    })),
  };
}

function resolveChecks(plan, session, snapshot, rng) {
  const adapter = getAdapter(session.gmSnapshot.ruleset?.formula || session.gmSnapshot.ruleset?.id || 'simple');
  return plan.checks.map((check) => {
    const result = adapter.evaluate(check.successPercent, rng);
    const sideEffect = adapter.sideEffect(check.checkKind, result.degree, rng);
    let resourceEffect = null;
    if (sideEffect) {
      const resource = snapshot.pcs[check.pcId]?.resources?.[sideEffect.key];
      const current = resource?.value ?? 0;
      const max = resource?.max ?? 999;
      resourceEffect = {
        key: sideEffect.key,
        delta: sideEffect.delta,
        value: Math.max(0, Math.min(max, current + sideEffect.delta)),
      };
    }
    return { ...check, ...result, resourceEffect };
  });
}

function normalizeOutcome(outcome, plan, checkResults) {
  const flags = Object.fromEntries(
    (outcome.globalUpdate?.flagUpdates || []).map((item) => [String(item.key).slice(0, 200), item.value]),
  );
  return {
    ...outcome,
    globalUpdate: { ...outcome.globalUpdate, flags },
    narratives: (outcome.narratives || []).map((item) => ({
      id: item.id,
      audience: { kind: item.audienceKind, ids: item.audienceIds || [] },
      text: item.text,
    })),
    autoActions: outcome.autoActions?.length ? outcome.autoActions : plan.autoActions,
    checkResults,
  };
}

export async function generatePartyResolution({
  session,
  snapshot,
  round,
  decisionResult = null,
  apiKey,
  model,
  fetchImpl = fetch,
  rng,
}) {
  const context = contextText({ session, snapshot, round, decisionResult });
  const rawPlan = await structuredCall({
    apiKey,
    model,
    fetchImpl,
    maxTokens: 3500,
    format: PLAN_FORMAT,
    system: `あなたは同時参加型TRPGのAI GM。全PCの行動を一つの共有世界で一括裁定する。

- 両立する行動は両方実行する。
- 同目的なら主行動と援護へまとめる。
- 個人で別行動可能なら多数決で消さない。
- Party全体で一つしか選べない排他的決定だけdecision_requiredにする。
- 文章量や説得力で勝者を選ばない。
- 判定が必要なら1PC最大1件、全PC数以下。AIは出目を決めない。
- source=autoの離席PCは防御・同行・援護だけ。裏切り、希少資源消費、契約、恋愛、絶縁、秘密告白、自己犠牲等の不可逆決定を禁止。
- 投票結果がある場合は確定事項として扱い、同じ決定を再要求しない。
- 指定JSONだけを返す。`,
    user: context,
  });
  const plan = normalizePlan(rawPlan, session);
  if (plan.resolution === 'decision_required') {
    return {
      resolution: 'decision_required',
      decision: { question: plan.decisionQuestion, options: plan.decisionOptions },
      autoActions: plan.autoActions,
    };
  }

  const checkResults = resolveChecks(plan, session, snapshot, rng);
  const outcome = await structuredCall({
    apiKey,
    model,
    fetchImpl,
    maxTokens: 6500,
    format: OUTCOME_FORMAT,
    system: `あなたは同時参加型TRPGのAI GM。裁定済み行動とコードが決めた判定結果から、共有世界を一度だけ更新し、PC別視点の物語を返す。

- 判定結果、成功度、資源変化を必ず描写へ反映する。
- 全narrativeは同じ正史から派生させ、互いに矛盾させない。
- 全員が知覚する描写はaudienceKind=all。別Sceneはscene、個人の知覚・秘密はpcs。
- PCの意思を勝手に追加せず、提出行動と安全なautoActionだけを扱う。
- fail forwardを使い、失敗でも状況を停止させない。
- scene分割可能だが共有時間を一段階だけ進める。
- choicesByPcは各PCに2〜4個。自由入力可能なため網羅不要。
- 指定JSONだけを返す。`,
    user: `${context}

# 裁定計画\n${JSON.stringify(plan, null, 2)}

# コード決定済み判定結果\n${JSON.stringify(checkResults, null, 2)}`,
  });
  return { resolution: 'advance', ...normalizeOutcome(outcome, plan, checkResults) };
}
