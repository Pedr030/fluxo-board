"use client";

import { useEffect, useState } from "react";
import { Theme, applyTheme, getCurrentTheme, setTheme } from "@/lib/theme";

/** Botão sol/lua — alterna e persiste o tema (localStorage via lib/theme.ts). */
export function ThemeToggle() {
  // Começa null pra não renderizar o ícone errado no servidor (lá não tem
  // como saber a preferência) e só decidir depois de montar no cliente.
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    const current = getCurrentTheme();
    applyTheme(current);
    setThemeState(current);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  if (!theme) {
    return <div className="h-10 w-10" />;
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Mudar pro tema claro" : "Mudar pro tema escuro"}
      className="flex h-10 w-10 items-center justify-center rounded-card border border-surface-border text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-500"
    >
      {theme === "dark" ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 1020.354 15.354z" />
        </svg>
      )}
    </button>
  );
}
