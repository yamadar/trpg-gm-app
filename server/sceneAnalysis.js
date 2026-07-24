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

const SYSTEM = `この場面の地の文に登場する人物を特定せよ。既知キャラ一覧(名前と見た目)に載っていない人物が登場する場合のみ、世界観・文脈に沿った簡潔な見た目(髪・服装・目立つ特徴)を新規に考案せよ。既知キャラの見た目は変更しないこと。PCシートに見た目の記述があればそれを優先する。present_namesにはこの場面に登場する全人物名を、new_appearancesには新規に見た目を決めた人物のみを入れること。`;

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
    const presentNames = Array.isArray(parsed.present_names)
      ? parsed.present_names.filter((n) => typeof n === 'string')
      : [];
    const newAppearances = Array.isArray(parsed.new_appearances)
      ? parsed.new_appearances
          .filter((a) => a && typeof a.name === 'string' && typeof a.description === 'string')
          .map((a) => ({ name: a.name, description: a.description }))
      : [];
    return { presentNames, newAppearances };
  } catch {
    return { presentNames: [], newAppearances: [] };
  }
}
