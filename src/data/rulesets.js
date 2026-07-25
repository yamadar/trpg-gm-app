export const RULESETS = [
  {
    id: 'simple',
    label: 'シンプル',
    desc: '判定は成功率%のみで統一。ルール色なし、テンポ重視。',
    hint: '',
    growthUnit: '経験値',
    formula: 'simple',
  },
  {
    id: 'coc7e',
    label: 'CoC7e風',
    desc: 'クトゥルフ神話TRPG風。恐怖・異常事態でSAN値チェックを演出。',
    hint: '恐怖・異常事態の場面では適宜roll_checkでSAN値チェックを表現し、正気度の変化は判定結果に応じて描写すること。',
    growthUnit: '経験値',
    formula: 'coc7e',
  },
  {
    id: 'dnd5e',
    label: 'D&D5e風',
    desc: 'ファンタジー王道。戦闘のクリティカルを演出。',
    hint: '戦闘や罠ではクリティカル(会心/致命的失敗)を演出に反映すること。',
    growthUnit: '経験値',
    formula: 'dnd5e',
  },
  {
    id: 'gurps',
    label: 'GURPS風',
    desc: '汎用ルール寄り。失敗の代償を細かく描写。',
    hint: '判定失敗の程度に応じて代償(時間・資源・状況悪化)を具体的に描写すること。',
    growthUnit: 'CP',
    formula: 'gurps',
  },
];
