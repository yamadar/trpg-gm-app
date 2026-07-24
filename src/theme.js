import { useEffect } from 'react';

export const COLORS = {
  paper: '#EDE6D6',
  paperDark: '#E2D9C3',
  card: '#F6F1E6',
  ink: '#1F2A38',
  inkSoft: '#3B372E',
  brass: '#9C7A45',
  brassDark: '#7C6136',
  stamp: '#A13D3D',
  stampDark: '#7E2E2E',
  line: '#C9BFA3',
  faint: '#B8AE93',
};

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Special+Elite&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap';

export const F_DISPLAY = "'Special Elite', 'Courier New', monospace";
export const F_BODY = "'Source Serif 4', Georgia, serif";
export const F_MONO = "'IBM Plex Mono', monospace";

export const inputStyle = {
  width: '100%',
  fontFamily: F_BODY,
  fontSize: 14,
  color: COLORS.inkSoft,
  background: COLORS.paper,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  padding: '10px 12px',
  outline: 'none',
  boxSizing: 'border-box',
};

// 雰囲気タグ(moods)ごとの控えめな配色調整。「紙の色味が変わる」程度に留め、
// 文字色(ink/inkSoft)は可読性のため変更しない。キーはsrc/constants/moods.jsのMOODSと対応。
const MOOD_THEMES = {
  ホラー: { paper: '#DAD5CB', accent: '#4A3F45' },
  冒険: { paper: '#EDE0C4', accent: '#9C7A45' },
  ミステリー: { paper: '#DDD9CE', accent: '#3C4656' },
  日常: { paper: '#F2ECDC', accent: '#7A8A5A' },
  SF: { paper: '#DCE0DA', accent: '#33505A' },
  ファンタジー: { paper: '#EFE3C8', accent: '#7C6136' },
  コメディ: { paper: '#F3EAD2', accent: '#B0763B' },
  シリアス: { paper: '#E4DFD2', accent: '#5A5548' },
};

// 先頭の既知moodの配色を返す。無し/未知のみは既定配色。
export function moodTheme(moods) {
  const hit = Array.isArray(moods) ? moods.find((m) => MOOD_THEMES[m]) : undefined;
  return hit ? MOOD_THEMES[hit] : { paper: COLORS.paper, accent: COLORS.brass };
}

// アニメーション可否。matchMediaが使えない環境(テスト等)やreduced-motion設定時は
// falseを返し、呼び出し側は従来どおりの即時表示(静的表示)に倒す。
export function motionAllowed() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById('trpg-fonts')) return;
    const link = document.createElement('link');
    link.id = 'trpg-fonts';
    link.rel = 'stylesheet';
    link.href = FONT_LINK;
    document.head.appendChild(link);
  }, []);
}
