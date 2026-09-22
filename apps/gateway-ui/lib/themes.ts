export const themes = [
  { id: 'strelizia', name: 'Strelizia', pilot: 'Zero Two', color: 'Vermelho' },
  { id: 'delphinium', name: 'Delphinium', pilot: 'Ichigo', color: 'Azul' },
  { id: 'argentea', name: 'Argentea', pilot: 'Miku', color: 'Rosa' },
  { id: 'genista', name: 'Genista', pilot: 'Kokoro', color: 'Verde' },
  { id: 'chlorophytum', name: 'Chlorophytum', pilot: 'Ikuno', color: 'Roxo' },
] as const;

export type ThemeId = (typeof themes)[number]['id'];
export const themeKey = 'jian.theme';
export const isTheme = (value: unknown): value is ThemeId => themes.some(({ id }) => id === value);

// Runs in the head before the first paint; the gateway hashes inline scripts in its CSP.
export const themeBootstrap = `try{var t=localStorage.getItem('${themeKey}');if(${JSON.stringify(themes.map(({ id }) => id))}.includes(t))document.documentElement.dataset.theme=t}catch{}`;
