/**
 * Símbolo do Fluxo — três barras (colunas de um board) + uma curva (o
 * "fluxo" de trabalho passando por elas). Ver docs/identidade-visual.html,
 * seção "Uso do símbolo": nunca usar as barras sem a curva, senão vira só
 * um ícone de gráfico de barras genérico.
 */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Símbolo Fluxo"
    >
      <rect x="4" y="20" width="9" height="28" rx="4" className="fill-brand-500" />
      <rect x="21.5" y="8" width="9" height="40" rx="4" className="fill-flow-500" />
      <rect x="39" y="28" width="9" height="20" rx="4" className="fill-accent-500" />
      <path
        d="M8 20 C 18 6, 34 6, 43 28"
        className="stroke-ink-soft"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}
