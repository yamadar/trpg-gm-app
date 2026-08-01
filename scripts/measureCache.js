// 暗黙キャッシュが実際に当たっているかを実測する開発用スクリプト。
//
//   npm run measure:cache                  # 既定は最長話(blood-tide 第5話)
//   npm run measure:cache -- kanemori-island
//   TURNS=8 npm run measure:cache
//
// 本物の buildSystemBlocks / buildTurnUserContent を通し、Play.jsx と同じ形で
// recent_log を伸ばしながら複数ターン回す。systemブロックは不変・user側だけが伸びる
// という実運用の並びを再現しないと、プレフィックス一致の判定を測ったことにならない。
//
// 判定の目安:
//   2ターン目以降 cached が input の大半 → 暗黙キャッシュが効いている(明示キャッシュは不要)
//   何ターン回しても cached=0            → 効いていない。明示キャッシュの検討対象
import 'dotenv/config';
import { buildSystemBlocks, buildTurnUserContent, TURN_OUTPUT_FORMAT } from '../src/api/prompts.js';
import { loadStarterPacks } from '../server/starters/loadPacks.js';
import { generateText } from '../server/textProvider.js';

const apiKey = process.env.GEMINI_TEXT_API_KEY;
const model = process.env.GEMINI_TEXT_MODEL;
if (!apiKey || !model) {
  console.error('GEMINI_TEXT_API_KEY と GEMINI_TEXT_MODEL を .env に設定してください');
  process.exit(1);
}

const packId = process.argv[2] || 'blood-tide-golden-funeral';
const turns = Number(process.env.TURNS || 5);

const packs = await loadStarterPacks();
const pack = packs.find((p) => p.id === packId);
if (!pack) {
  console.error(`unknown pack "${packId}". available: ${packs.map((p) => p.id).join(', ')}`);
  process.exit(1);
}
// 一番厳しいケースを既定にする。最長の話を選ぶ。
const scenario = [...pack.scenarios].sort((a, b) => b.raw.length - a.raw.length)[0];

const session = {
  world: { summary: pack.worldRaw },
  scenario: { raw: scenario.raw, directorGuide: null },
  pc: { raw: pack.pc[0].raw, goal: '目標', bonds: '因縁' },
  ruleset: { id: pack.recommendedRuleset, label: '簡易', growthUnit: '経験値' },
  state: {
    current_scene: '導入',
    flags: {},
    history_summary: '',
    recent_log: [],
    explained_terms: [],
  },
};

const system = buildSystemBlocks(session);
console.log(`pack=${pack.id} scenario=${scenario.id} (${scenario.raw.length} chars)`);
console.log(`system block: ${system[0].text.length} chars / turns: ${turns}\n`);
console.log('turn  input  cached   hit%  output   total');

let totalInput = 0;
let totalCached = 0;
for (let turn = 1; turn <= turns; turn += 1) {
  const data = await generateText({
    apiKey,
    model,
    request: {
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: buildTurnUserContent(session, '周囲を調べる') }],
      output_config: { format: TURN_OUTPUT_FORMAT },
    },
    timeoutMs: 120000,
  });

  const u = data.usage;
  if (!u) {
    console.log(`${String(turn).padStart(4)}  (usageMetadata がレスポンスに含まれていない)`);
    continue;
  }
  totalInput += u.input_tokens;
  totalCached += u.cached_input_tokens;
  console.log(
    `${String(turn).padStart(4)}${String(u.input_tokens).padStart(7)}` +
      `${String(u.cached_input_tokens).padStart(8)}${(u.cache_hit_ratio * 100).toFixed(0).padStart(6)}%` +
      `${String(u.output_tokens).padStart(8)}${String(u.total_tokens).padStart(8)}`,
  );

  // Play.jsx と同じ要領で履歴を伸ばす。systemは据え置き、user側だけが変わる。
  session.state.recent_log.push({ role: 'player', text: '周囲を調べる' });
  session.state.recent_log.push({ role: 'gm', text: `${turn}ターン目の描写。` });
  while (session.state.recent_log.length > 12) session.state.recent_log.shift();
}

const ratio = totalInput > 0 ? (100 * totalCached) / totalInput : 0;
console.log(`\n合計 input=${totalInput} cached=${totalCached} (${ratio.toFixed(1)}%)`);
console.log(
  ratio > 40
    ? '=> 暗黙キャッシュが効いている。明示キャッシュ(Phase 1)は不要の公算が大きい。'
    : '=> ほとんど効いていない。明示キャッシュ(Phase 1)の検討対象。',
);
