const BASE_STYLE = 'atmospheric digital illustration, detailed, cinematic lighting, no text, no speech bubbles';

// キーは src/constants/moods.js / server/storage/moods.js の MOODS(固定8種)と対応。
const MOOD_STYLE = {
  ホラー: 'dark, ominous, unsettling horror mood',
  冒険: 'epic adventurous fantasy',
  ミステリー: 'moody noir, muted tones',
  日常: 'warm slice-of-life',
  SF: 'sci-fi, cool tones, futuristic',
  ファンタジー: 'high fantasy, painterly',
  コメディ: 'bright cheerful',
  シリアス: 'somber, desaturated',
};

export function buildImagePrompt({ narrative = '', moods = [], appearances = [], hasReferences = false }) {
  const styles = Array.isArray(moods)
    ? [...new Set(moods.map((m) => MOOD_STYLE[m]).filter(Boolean))].slice(0, 2)
    : [];
  const style = styles.length ? styles.join(', ') : 'neutral tone';
  // 後半にある動作・視線・位置関係も構図の根拠にするため、場面を途中で切らない。
  const scene = String(narrative || '').trim();
  const cast = (appearances || [])
    .filter((a) => a && a.name && a.description)
    .map((a, index) => `${index + 1}. ${a.name}: ${a.description}`);
  const lines = [`${BASE_STYLE}, ${style}.`];
  lines.push('一枚の絵には同じ時点の一場面だけを描く。複数の出来事が続く本文では、結末側の具体的な動作を一つ選び、その瞬間を描く。連続動作を同じ人物の複数の姿で表現せず、分割画面・コラージュ・別枠の顔アップを作らない。');
  if (cast.length) {
    lines.push(`# 描く人物（合計${cast.length}人。人物ごとの特徴を混ぜない）\n${cast.join('\n')}`);
    lines.push('上記にない人物を追加せず、同じ人物を重複して描かない。顔、髪、服装、武器の特徴を人物間で入れ替えない。');
  }
  lines.push('同じ人物は画面内に一体だけ描く。名前・肩書き・代名詞が同じ人物を指す場合は一人として扱う。本文に明示されない分身・双子・鏡像を追加しない。');
  lines.push('人物を描く場合、各人物を場面の出来事に反応した自然な動作中の姿で描く。重心・手足・視線を状況に合わせ、互いと環境との関係が分かるポーズにする。');
  lines.push('人物の位置、体の向き、顔の向き、視線の先は場面本文を優先する。誰が何を見ているか、対象がどこにあるかを構図で明確にし、視線をその対象へ向ける。例えば奥の扉の向こうを見ている人物は、手前に後ろ姿または肩越しに置き、人物の前方に扉とその先の光景を描く。顔を見せるために鑑賞者側へ振り向かせない。本文にないカメラ目線にしない。');
  lines.push('人物を描く場合、顔が見える構図では各人物の表情を場面の感情と緊張度に合わせる。後ろ姿では顔や目が見えなくてよく、姿勢や手の動きで感情を表す。場面が明示的に静止・無感情を求めない限り、棒立ち、正面向きの記念写真風ポーズ、無表情を避ける。風景・物だけの場面へ人物を追加しない。');
  if (scene) lines.push(`場面: ${scene}`);
  if (hasReferences) lines.push('参照画像は人物名ラベルに対応する登場人物の外見資料であり、追加の登場人物ではない。顔立ち・髪型・髪色・服装などの同一性を厳密に維持するが、参照画像のポーズ・表情・体や顔の向き・カメラ目線・画角・背景は引き継がない。構図と動作は場面本文を優先する。後ろ姿では髪・服装・装備で同一人物と分かるようにし、顔を別に描き足さない。参照画像同士の特徴を混ぜない。');
  return lines.join('\n');
}

// キャラポートレート用プロンプト。シーン挿絵の参照画像として使うため
// バストアップ・無地背景に固定し、画風はシーンと同じmoodマッピングを共用する。
export function buildPortraitPrompt({ name = '', description = '', moods = [] }) {
  const styles = Array.isArray(moods)
    ? [...new Set(moods.map((m) => MOOD_STYLE[m]).filter(Boolean))].slice(0, 2)
    : [];
  const style = styles.length ? styles.join(', ') : 'neutral tone';
  const lines = [`character portrait, bust shot, plain background, ${BASE_STYLE}, ${style}.`];
  lines.push('描く人物は一人だけ。一つの頭部と一つの身体を持つ単独のバストアップ。複数方向の姿を並べた設定画、分割画面、別枠の顔アップ、鏡像、背景の人物を含めない。');
  if (name || description) lines.push(`人物: ${name}=${description}`);
  return lines.join('\n');
}
