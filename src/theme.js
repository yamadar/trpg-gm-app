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
