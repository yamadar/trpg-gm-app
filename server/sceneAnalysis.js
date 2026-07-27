import { generateText } from './textProvider.js';

const ANALYSIS_TIMEOUT_MS = 60000;

const ANALYSIS_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['present_names', 'new_appearances'],
    properties: {
      present_names: { type: 'array', items: { type: 'string' } },
      new_appearances: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description'],
          properties: { name: { type: 'string' }, description: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM = `この場面の地の文を読み、挿絵に描くべき人物を特定せよ。

# present_names
- その場面に実際に居合わせ、挿絵に姿が描かれる人物の名前のみを入れる。
- 名前が出てくるだけの人物(話題に上るだけ、伝聞、回想、手紙の差出人など、その場にいない人物)は含めない。
- 人物が誰も描かれない場面(風景・物のみ)では空配列にする。

# new_appearances
- present_names のうち、既知キャラ一覧(名前と見た目)に載っていない人物についてのみ、世界観・文脈に沿った見た目を新規に考案する。
- description は以後の挿絵すべてで同一人物を再現するための固定設定。次の「指定されないと変化しやすい要素」を、本文に明記がなければ世界観に合う内容で決め、必ず含める。
  - 種族(人間の場合も「人間」と明記)
  - 肌の色
  - 髪型と髪色(禿頭など、髪がない場合も明記)
  - 服装の種類と主要な色
  - 武器を持つ人物は、武器の種類・素材・形状・色など識別できる特徴。持たない人物は「武器なし」と明記
  - 年齢層・体格・目の色・目立つ装身具や身体的特徴
- 「普通の服」「一般的な剣」のような曖昧な表現を避け、色・形・素材を具体化する。
- 性格・役割・立場・人間関係・境遇・その場にいるかどうかなど、見た目以外の情報は一切書かない。
  良い例: 「人間、20代半ばの男。褐色の肌、灰色の目、短く刈った黒髪、痩せ型。焦げ茶の擦り切れた革コートと生成りのシャツ。武器は黒鉄製で片刃の細身の長剣」
  悪い例: 「ゲオルクの息子。迷信を信じない現実主義者。この場面には登場せず言及されるのみ」
- 既知キャラの見た目は変更しない。PCシートに見た目の記述があればそれを優先する。`;

export async function analyzeScene({ narrative, registry = {}, pcRaw = '', apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) return { presentNames: [], newAppearances: [] };
  const known =
    Object.values(registry)
      .map((a) => `${a.name}: ${a.description}`)
      .join('\n') || '(なし)';
  const user = `# 地の文\n${narrative}\n\n# 既知キャラ\n${known}\n\n# PCシート(抜粋)\n${(pcRaw || '').slice(0, 600) || '(なし)'}`;
  try {
    const data = await generateText({
      apiKey,
      model,
      fetchImpl,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
      request: {
        max_tokens: 2000,
        system: SYSTEM,
        output_config: { format: ANALYSIS_FORMAT },
        messages: [{ role: 'user', content: user }],
      },
    });
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = JSON.parse(text);
    const presentNamesRaw = Array.isArray(parsed.present_names)
      ? parsed.present_names.filter((n) => typeof n === 'string')
      : [];
    const presentNames = [...new Set(presentNamesRaw)];
    // その場にいない人物(言及されるだけ)の見た目は登録しない。
    // 挿絵プロンプトにも載らないため、ポートレート生成の消費だけが無駄になる。
    const present = new Set(presentNames);
    const newAppearances = Array.isArray(parsed.new_appearances)
      ? parsed.new_appearances
          .filter((a) => a && typeof a.name === 'string' && typeof a.description === 'string')
          .filter((a) => present.has(a.name))
          .map((a) => ({ name: a.name, description: a.description }))
      : [];
    return { presentNames, newAppearances };
  } catch {
    return { presentNames: [], newAppearances: [] };
  }
}
