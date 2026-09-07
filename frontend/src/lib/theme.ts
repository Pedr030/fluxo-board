export type Theme = "light" | "dark";

const STORAGE_KEY = "fluxo_theme";

function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Tema efetivo agora: escolha manual salva, ou a do sistema operacional. */
export function getCurrentTheme(): Theme {
  return getStoredTheme() ?? (systemPrefersDark() ? "dark" : "light");
}

/**
 * Aplica a classe `.dark`/`.light` no <html> (ver globals.css — é isso que
 * o Tailwind com `darkMode: "class"` observa). Sempre marca uma das duas,
 * mesmo em "light": sem isso, o CSS não teria como distinguir "usuário
 * escolheu claro" de "usuário nunca mexeu e o SO está em claro" — e um
 * toggle manual pra claro com o SO em dark não conseguiria vencer o
 * `prefers-color-scheme` do globals.css.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Script inline (ver layout.tsx) — roda antes do React hidratar, pra não
 * piscar o tema errado por uma fração de segundo. */
export const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.add(theme);
  } catch (e) {}
})();
`;
