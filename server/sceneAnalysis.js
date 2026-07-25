const ANALYSIS_TIMEOUT_MS = 60000;
const MODEL = 'claude-sonnet-5';

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
- description には見た目だけを簡潔に書く(年齢層・髪・目・肌・服装・体格・持ち物・目立つ特徴)。
- 性格・役割・立場・人間関係・境遇・その場にいるかどうかなど、見た目以外の情報は一切書かない。
  良い例: 「20代半ばの男。短い黒髪、無精髭、擦り切れた革のコート」
  悪い例: 「ゲオルクの息子。迷信を信じない現実主義者。この場面には登場せず言及されるのみ」
- 既知キャラの見た目は変更しない。PCシートに見た目の記述があればそれを優先する。`;

export async function analyzeScene({ narrative, registry = {}, pcRaw = '', apiKey, fetchImpl = fetch }) {
  if (!apiKey) return { presentNames: [], newAppearances: [] };
  const known =
    Object.values(registry)
      .map((a) => `${a.name}: ${a.description}`)
      .join('\n') || '(なし)';
  const user = `# 地の文\n${narrative}\n\n# 既知キャラ\n${known}\n\n# PCシート(抜粋)\n${(pcRaw || '').slice(0, 600) || '(なし)'}`;
  try {
    const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: 'disabled' },
        system: SYSTEM,
        output_config: { format: ANALYSIS_FORMAT },
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });
    if (!upstream.ok) return { presentNames: [], newAppearances: [] };
    const data = await upstream.json();
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
